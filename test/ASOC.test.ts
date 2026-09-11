import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const ONE = ethers.parseEther("1");
const HOUR = 60 * 60;
const MONTH = 30 * 24 * HOUR;

describe("ASOC", () => {
  async function deploy() {
    const [owner, holder, premium, other] = await ethers.getSigners();
    const ASOC = await ethers.getContractFactory("ASOC");
    const asoc = await ASOC.deploy();
    return { asoc, owner, holder, premium, other };
  }

  it("Phase 1: a wallet mints any buy-in, stakes during lock, and receives the hourly bonus", async () => {
    const { asoc, owner, holder } = await deploy();
    await asoc.mintPurchase(holder.address, ONE / 2n, ONE / 2n, ethers.id("purchase-half"));
    expect(await asoc.balanceOf(holder.address)).to.equal(ONE / 2n);
    await asoc.notifyVolume(ONE);
    await asoc.connect(holder).stake(ONE / 2n);
    expect(await asoc.staked(holder.address)).to.equal(ONE / 2n);
    await time.increase(HOUR);
    const before = await asoc.balanceOf(holder.address);
    await asoc.connect(holder).claimBonus();
    const paid = (await asoc.balanceOf(holder.address)) - before;
    expect(paid).to.be.closeTo(
      ethers.parseEther("0.005"),
      ethers.parseEther("0.000002"),
    );
    expect(owner.address).to.not.equal(ethers.ZeroAddress);
  });

  it("rejects a zero buy-in, rejects replay, and locks transfers for 30 days", async () => {
    const { asoc, holder, other } = await deploy();
    const purchaseId = ethers.id("purchase-lock");
    await expect(asoc.mintPurchase(holder.address, 0n, ONE, purchaseId)).to.be.revertedWith("amount");
    await asoc.mintPurchase(holder.address, ONE, ONE, purchaseId);
    await expect(
      asoc.mintPurchase(holder.address, ONE, ONE, purchaseId),
    ).to.be.revertedWith("purchase processed");
    expect(await asoc.balanceOf(holder.address)).to.equal(ONE);
    await expect(asoc.connect(holder).transfer(other.address, 1n)).to.be.revertedWith("locked 30 days");
    await time.increase(MONTH);
    await expect(asoc.connect(holder).transfer(other.address, 1n)).to.not.be.reverted;
  });

  it("allows stake during lock and pays 1% hourly from the reserve slice", async () => {
    const { asoc, holder } = await deploy();
    await asoc.mintPurchase(
      holder.address,
      ethers.parseEther("100"),
      ethers.parseEther("100"),
      ethers.id("purchase-regular"),
    );
    await asoc.notifyVolume(ethers.parseEther("100"));
    await asoc.connect(holder).stake(ethers.parseEther("100"));
    await time.increase(HOUR);
    const before = await asoc.balanceOf(holder.address);
    await asoc.connect(holder).claimBonus();
    const paid = (await asoc.balanceOf(holder.address)) - before;
    expect(paid).to.be.closeTo(
      ethers.parseEther("1"),
      ethers.parseEther("0.0003"),
    );
  });

  it("pays premium 5% hourly instead of 1%", async () => {
    const { asoc, premium } = await deploy();
    await asoc.mintPurchase(
      premium.address,
      ethers.parseEther("100"),
      ethers.parseEther("100"),
      ethers.id("purchase-premium"),
    );
    await asoc.setPremium(premium.address, true);
    await asoc.connect(premium).stake(ethers.parseEther("100"));
    await asoc.notifyVolume(ethers.parseEther("1000"));
    await time.increase(HOUR);
    await asoc.connect(premium).claimBonus();
    expect(await asoc.balanceOf(premium.address)).to.be.closeTo(
      ethers.parseEther("5"),
      ethers.parseEther("0.003"),
    );
  });

  it("haircuts claims that exceed the 0.7% slice budget", async () => {
    const { asoc, holder } = await deploy();
    await asoc.mintPurchase(holder.address, ONE, ONE, ethers.id("purchase-haircut"));
    await asoc.connect(holder).stake(ONE);
    await time.increase(HOUR * 24);
    await asoc.connect(holder).claimBonus();
    const budgetSlice = (ONE * 70n) / 10_000n;
    expect(await asoc.balanceOf(holder.address)).to.equal(budgetSlice);
    expect(await asoc.rewardBudget()).to.equal(0n);
    expect(await asoc.totalRewardsPaid()).to.equal(budgetSlice);
    expect(await asoc.totalRewardsPaid()).to.be.at.most(
      ((await asoc.cumulativeVolume()) * 70n) / 10_000n,
    );
  });

  it("haircuts insufficient budget pro-rata instead of first-claimant-wins", async () => {
    const { asoc, holder, other } = await deploy();
    await asoc.mintPurchase(
      holder.address,
      ethers.parseEther("100"),
      ethers.parseEther("50"),
      ethers.id("purchase-pro-rata-a"),
    );
    await asoc.mintPurchase(
      other.address,
      ethers.parseEther("100"),
      ethers.parseEther("50"),
      ethers.id("purchase-pro-rata-b"),
    );
    await asoc.connect(holder).stake(ethers.parseEther("100"));
    await asoc.connect(other).stake(ethers.parseEther("100"));
    await time.increase(HOUR);

    await asoc.connect(holder).claimBonus();
    await asoc.connect(other).claimBonus();

    expect(await asoc.balanceOf(holder.address)).to.be.greaterThan(0n);
    expect(await asoc.balanceOf(other.address)).to.be.greaterThan(0n);
    expect(await asoc.balanceOf(holder.address)).to.be.lessThan(ethers.parseEther("0.7"));
  });

  it("sends a paid message during lock via small ASOC transfer", async () => {
    const { asoc, holder, other } = await deploy();
    await asoc.mintPurchase(holder.address, ONE, ONE, ethers.id("purchase-message"));
    const fee = await asoc.messageFee();
    const hash = ethers.id("hello");
    await expect(asoc.connect(holder).sendPaidMessage(other.address, hash))
      .to.emit(asoc, "PaidMessage")
      .withArgs(holder.address, other.address, hash, fee);
    expect(await asoc.balanceOf(other.address)).to.equal(fee);
  });
});

describe("HaulLedger", () => {
  it("confirms pickup then records delivery plate, load, miles, rate, reserve", async () => {
    const [owner] = await ethers.getSigners();
    const Ledger = await ethers.getContractFactory("HaulLedger");
    const ledger = await Ledger.deploy();
    await expect(ledger.confirmPickup("LOAD-1", "ABC1234")).to.emit(ledger, "PickupConfirmed");
    await expect(ledger.recordHaul("ABC1234", "LOAD-1", 420, 150_000_000, 15_000_000))
      .to.emit(ledger, "HaulRecorded");
    expect(await ledger.pickedUpAt("LOAD-1")).to.be.greaterThan(0n);
    expect(await ledger.haulCount()).to.equal(1n);
    expect(owner.address).to.not.equal(ethers.ZeroAddress);
  });
});

describe("DriverPayout", () => {
  it("pays USDC on delivery and emits plate, load, miles, rate, reserve", async () => {
    const [payer, driver] = await ethers.getSigners();
    const USDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await USDC.deploy();
    const Payout = await ethers.getContractFactory("DriverPayout");
    const payout = await Payout.deploy(await usdc.getAddress());
    await usdc.mint(await payout.getAddress(), 90_000_000);
    await expect(
      payout.payOnDelivery(driver.address, 90_000_000, "ABC1234", "LOAD-1", 420, 100_000_000, 10_000_000),
    )
      .to.emit(payout, "DriverPaid")
      .withArgs(driver.address, 90_000_000, "ABC1234", "LOAD-1", 420, 100_000_000, 10_000_000);
    expect(await usdc.balanceOf(driver.address)).to.equal(90_000_000);
    expect(payer.address).to.not.equal(ethers.ZeroAddress);
  });
});
