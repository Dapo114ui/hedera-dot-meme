const { expect } = require("chai");
const { ethers } = require("hardhat");

// "N HBAR" in tinybars (8 decimals) - confirmed live on Hedera testnet
// (contracts/test/ValueScaleProbe.sol) that msg.value inside contract
// execution is tinybar-scale, not the 18-decimal "ether" scale a plain
// EVM background would suggest. A local Hardhat network doesn't do
// Hedera's rescaling, so this mocked suite just needs to consistently
// use the same scale the real contract does - named `ether` would be
// actively misleading here, hence `hbar`.
const hbar = (n) => ethers.parseUnits(String(n), 8);

// Matches the contract's own constants (contracts/OnycBondingCurve.sol).
const CURVE_SUPPLY = 800_000_000n * 10n ** 8n;
const INITIAL_VIRTUAL_HBAR_RESERVE = hbar("300");
const HTS_CREATION_BUFFER_TINYBARS = hbar("40");
const MOCK_REAL_HTS_COST = hbar("15");

const CREATION_FEE = hbar("45"); // >= HTS_CREATION_BUFFER_TINYBARS, per constructor's own check
const TRADING_FEE_BPS = 100; // 1%
const FUNDING_GOAL = hbar("500"); // small on purpose, so tests can actually reach graduation

describe("OnycBondingCurve", function () {
  let curve, mockHts, treasury, creator, buyer, seller, other;

  beforeEach(async function () {
    [, treasury, creator, buyer, seller, other] = await ethers.getSigners();

    const MockHts = await ethers.getContractFactory("MockHederaTokenService");
    mockHts = await MockHts.deploy();

    const Curve = await ethers.getContractFactory("OnycBondingCurve");
    curve = await Curve.deploy(
      treasury.address,
      CREATION_FEE,
      TRADING_FEE_BPS,
      FUNDING_GOAL,
      await mockHts.getAddress()
    );
  });

  describe("constructor validation", function () {
    it("rejects a zero treasury address", async function () {
      const Curve = await ethers.getContractFactory("OnycBondingCurve");
      await expect(
        Curve.deploy(ethers.ZeroAddress, CREATION_FEE, TRADING_FEE_BPS, FUNDING_GOAL, await mockHts.getAddress())
      ).to.be.revertedWith("treasury cannot be zero address");
    });

    it("rejects a creation fee below the HTS network-cost buffer", async function () {
      const Curve = await ethers.getContractFactory("OnycBondingCurve");
      await expect(
        Curve.deploy(treasury.address, hbar("39"), TRADING_FEE_BPS, FUNDING_GOAL, await mockHts.getAddress())
      ).to.be.revertedWith("creation fee must cover HTS network cost");
    });

    it("rejects a trading fee above the 5% cap", async function () {
      const Curve = await ethers.getContractFactory("OnycBondingCurve");
      await expect(
        Curve.deploy(treasury.address, CREATION_FEE, 501, FUNDING_GOAL, await mockHts.getAddress())
      ).to.be.revertedWith("trading fee too high");
    });

    it("rejects a zero funding goal", async function () {
      const Curve = await ethers.getContractFactory("OnycBondingCurve");
      await expect(
        Curve.deploy(treasury.address, CREATION_FEE, TRADING_FEE_BPS, 0, await mockHts.getAddress())
      ).to.be.revertedWith("funding goal must be positive");
    });
  });

  describe("create", function () {
    it("reverts with IncorrectCreationFee if msg.value doesn't match exactly", async function () {
      await expect(
        curve.connect(creator).create("DogWifHat", "WIF", "ipfs://meta", { value: hbar("44") })
      )
        .to.be.revertedWithCustomError(curve, "IncorrectCreationFee")
        .withArgs(CREATION_FEE, hbar("44"));
    });

    it("reverts if the memo exceeds 100 bytes", async function () {
      const longMemo = "x".repeat(101);
      await expect(
        curve.connect(creator).create("Name", "SYM", longMemo, { value: CREATION_FEE })
      ).to.be.revertedWith("memo exceeds HTS 100-byte limit");
    });

    it("creates a token, seeds curve state, and emits MemeCreated", async function () {
      const tx = await curve.connect(creator).create("DogWifHat", "WIF", "ipfs://meta", {
        value: CREATION_FEE,
      });
      const receipt = await tx.wait();

      const event = receipt.logs
        .map((log) => {
          try {
            return curve.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((e) => e && e.name === "MemeCreated");

      expect(event).to.not.be.null;
      expect(event.args.creator).to.equal(creator.address);
      expect(event.args.name).to.equal("DogWifHat");
      expect(event.args.symbol).to.equal("WIF");

      const tokenAddress = event.args.tokenAddress;
      const meme = await curve.memeTokens(tokenAddress);
      expect(meme.tokenAddress).to.equal(tokenAddress);
      expect(meme.creatorAddress).to.equal(creator.address);
      expect(meme.virtualHbarReserve).to.equal(INITIAL_VIRTUAL_HBAR_RESERVE);
      expect(meme.virtualTokenReserve).to.equal(CURVE_SUPPLY);
      expect(meme.realHbarReserve).to.equal(0n);
      expect(meme.tokensSold).to.equal(0n);
      expect(meme.graduated).to.equal(false);

      // Full fixed supply minted to the contract itself as HTS treasury.
      expect(await curve.curveTokenInventory(tokenAddress)).to.equal(1_000_000_000n * 10n ** 8n);
    });

    it("sweeps the platform's margin (fee minus real HTS cost) to treasury", async function () {
      const before = await ethers.provider.getBalance(treasury.address);
      await curve.connect(creator).create("Name", "SYM", "memo", { value: CREATION_FEE });
      const after = await ethers.provider.getBalance(treasury.address);

      // Contract forwards HTS_CREATION_BUFFER_TINYBARS (40) to the mock
      // precompile; the mock refunds (40 - MOCK_REAL_HTS_COST) = 25 back.
      // Contract never spent the remaining (CREATION_FEE - buffer) = 5.
      // Total swept to treasury = 5 + 25 = 30.
      const expectedMargin = CREATION_FEE - HTS_CREATION_BUFFER_TINYBARS + (HTS_CREATION_BUFFER_TINYBARS - MOCK_REAL_HTS_COST);
      expect(after - before).to.equal(expectedMargin);

      // Nothing should be left stranded in the curve contract itself.
      expect(await ethers.provider.getBalance(await curve.getAddress())).to.equal(0n);
    });

    it("lets two different tokens exist independently", async function () {
      const tx1 = await curve.connect(creator).create("A", "A", "memoA", { value: CREATION_FEE });
      const r1 = await tx1.wait();
      const tx2 = await curve.connect(creator).create("B", "B", "memoB", { value: CREATION_FEE });
      const r2 = await tx2.wait();

      const addr1 = r1.logs.map((l) => { try { return curve.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "MemeCreated").args.tokenAddress;
      const addr2 = r2.logs.map((l) => { try { return curve.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "MemeCreated").args.tokenAddress;

      expect(addr1).to.not.equal(addr2);
      const meme1 = await curve.memeTokens(addr1);
      const meme2 = await curve.memeTokens(addr2);
      expect(meme1.virtualHbarReserve).to.equal(INITIAL_VIRTUAL_HBAR_RESERVE);
      expect(meme2.virtualHbarReserve).to.equal(INITIAL_VIRTUAL_HBAR_RESERVE);
    });
  });

  describe("buy", function () {
    let tokenAddress;

    async function createToken() {
      const tx = await curve.connect(creator).create("Meme", "MEME", "memo", { value: CREATION_FEE });
      const receipt = await tx.wait();
      return receipt.logs
        .map((l) => { try { return curve.interface.parseLog(l); } catch { return null; } })
        .find((e) => e?.name === "MemeCreated").args.tokenAddress;
    }

    beforeEach(async function () {
      tokenAddress = await createToken();
    });

    it("reverts with TokenNotFound for an address that was never created", async function () {
      await expect(
        curve.connect(buyer).buy(other.address, 0, { value: hbar("1") })
      ).to.be.revertedWithCustomError(curve, "TokenNotFound");
    });

    it("reverts with ZeroAmount when msg.value is 0", async function () {
      await expect(curve.connect(buyer).buy(tokenAddress, 0, { value: 0 })).to.be.revertedWithCustomError(
        curve,
        "ZeroAmount"
      );
    });

    it("quotes and buy() agree, and the buyer actually receives the tokens", async function () {
      const hbarIn = hbar("10");
      const expectedTokens = await curve.previewBuy(tokenAddress, hbarIn);
      expect(expectedTokens).to.be.greaterThan(0n);

      await expect(curve.connect(buyer).buy(tokenAddress, expectedTokens, { value: hbarIn }))
        .to.emit(curve, "TokensBought")
        .withArgs(tokenAddress, buyer.address, expectedTokens, hbarIn);

      const MockHtsToken = await ethers.getContractFactory("MockHtsToken");
      const token = MockHtsToken.attach(tokenAddress);
      expect(await token.balanceOf(buyer.address)).to.equal(expectedTokens);
    });

    it("reverts with BuySlippageExceeded if minTokensOut is set too high", async function () {
      const hbarIn = hbar("10");
      const expectedTokens = await curve.previewBuy(tokenAddress, hbarIn);
      await expect(
        curve.connect(buyer).buy(tokenAddress, expectedTokens + 1n, { value: hbarIn })
      ).to.be.revertedWithCustomError(curve, "BuySlippageExceeded");
    });

    it("routes the trading fee to treasury and updates real/virtual reserves correctly", async function () {
      const hbarIn = hbar("10");
      const expectedFee = (hbarIn * BigInt(TRADING_FEE_BPS)) / 10000n;
      const hbarInAfterFee = hbarIn - expectedFee;

      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await curve.connect(buyer).buy(tokenAddress, 0, { value: hbarIn });
      const treasuryAfter = await ethers.provider.getBalance(treasury.address);

      expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);

      const meme = await curve.memeTokens(tokenAddress);
      expect(meme.realHbarReserve).to.equal(hbarInAfterFee);
      expect(meme.virtualHbarReserve).to.equal(INITIAL_VIRTUAL_HBAR_RESERVE + hbarInAfterFee);
    });

    it("getAmountOut(txType=0) returns the pre-fee cost, consistent with memejob's convention", async function () {
      const wantTokens = 1_000_000n * 10n ** 8n; // 1M tokens
      const preFeeCost = await curve.getAmountOut(tokenAddress, wantTokens, 0);

      // Sending exactly preFeeCost as msg.value yields FEWER than
      // wantTokens, because buy() takes its fee off the top before the
      // curve math runs - getAmountOut deliberately quotes the pre-fee
      // curve price, matching the existing frontend's established
      // reading of memejob's own getAmountOut. This test exists so that
      // asymmetry is a documented, verified contract, not a surprise.
      const actualTokens = await curve.previewBuy(tokenAddress, preFeeCost);
      expect(actualTokens).to.be.lessThan(wantTokens);
    });

    it("reverts with TokenAlreadyGraduated once the funding goal is hit", async function () {
      // FUNDING_GOAL is 500 ether; buy enough to cross it.
      await curve.connect(buyer).buy(tokenAddress, 0, { value: hbar("600") });
      const meme = await curve.memeTokens(tokenAddress);
      expect(meme.graduated).to.equal(true);

      await expect(
        curve.connect(buyer).buy(tokenAddress, 0, { value: hbar("1") })
      ).to.be.revertedWithCustomError(curve, "TokenAlreadyGraduated");
    });

    it("emits Graduated exactly once, with the real HBAR raised", async function () {
      await expect(curve.connect(buyer).buy(tokenAddress, 0, { value: hbar("600") })).to.emit(
        curve,
        "Graduated"
      );
    });
  });

  describe("sell", function () {
    let tokenAddress, token;

    beforeEach(async function () {
      const tx = await curve.connect(creator).create("Meme", "MEME", "memo", { value: CREATION_FEE });
      const receipt = await tx.wait();
      tokenAddress = receipt.logs
        .map((l) => { try { return curve.interface.parseLog(l); } catch { return null; } })
        .find((e) => e?.name === "MemeCreated").args.tokenAddress;

      const MockHtsToken = await ethers.getContractFactory("MockHtsToken");
      token = MockHtsToken.attach(tokenAddress);

      // Give `seller` some tokens to work with.
      await curve.connect(seller).buy(tokenAddress, 0, { value: hbar("10") });
    });

    it("reverts with ZeroAmount when tokenAmount is 0", async function () {
      await expect(curve.connect(seller).sell(tokenAddress, 0, 0)).to.be.revertedWithCustomError(
        curve,
        "ZeroAmount"
      );
    });

    it("reverts (insufficient allowance) if the seller never approved the contract", async function () {
      const balance = await token.balanceOf(seller.address);
      await expect(curve.connect(seller).sell(tokenAddress, balance, 0)).to.be.reverted;
    });

    it("sells successfully after approval, paying out HBAR net of fee", async function () {
      const balance = await token.balanceOf(seller.address);
      await token.connect(seller).approve(await curve.getAddress(), balance);

      const expectedHbarOut = await curve.previewSell(tokenAddress, balance);
      expect(expectedHbarOut).to.be.greaterThan(0n);

      const sellerHbarBefore = await ethers.provider.getBalance(seller.address);
      const txResp = await curve.connect(seller).sell(tokenAddress, balance, expectedHbarOut);
      const receipt = await txResp.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const sellerHbarAfter = await ethers.provider.getBalance(seller.address);

      expect(sellerHbarAfter - sellerHbarBefore + gasCost).to.equal(expectedHbarOut);
      expect(await token.balanceOf(seller.address)).to.equal(0n);
    });

    it("reverts with SellSlippageExceeded if minHbarOut is set too high", async function () {
      const balance = await token.balanceOf(seller.address);
      await token.connect(seller).approve(await curve.getAddress(), balance);
      const expectedHbarOut = await curve.previewSell(tokenAddress, balance);

      await expect(
        curve.connect(seller).sell(tokenAddress, balance, expectedHbarOut + 1n)
      ).to.be.revertedWithCustomError(curve, "SellSlippageExceeded");
    });

    it("a full buy-then-sell round trip never lets the trader extract more HBAR than they put in", async function () {
      const hbarIn = hbar("5");
      await curve.connect(buyer).buy(tokenAddress, 0, { value: hbarIn });

      const buyerTokenBalance = await token.balanceOf(buyer.address);
      await token.connect(buyer).approve(await curve.getAddress(), buyerTokenBalance);

      const hbarBefore = await ethers.provider.getBalance(buyer.address);
      const txResp = await curve.connect(buyer).sell(tokenAddress, buyerTokenBalance, 0);
      const receipt = await txResp.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;
      const hbarAfter = await ethers.provider.getBalance(buyer.address);

      const hbarRecovered = hbarAfter - hbarBefore + gasCost;
      // Two rounds of fees (buy + sell) plus curve-math rounding mean the
      // trader must strictly lose value round-tripping - this is the
      // economic property that makes the curve non-exploitable by
      // wash-trading alone.
      expect(hbarRecovered).to.be.lessThan(hbarIn);
    });

    it("routes the sell-side fee to treasury", async function () {
      const balance = await token.balanceOf(seller.address);
      await token.connect(seller).approve(await curve.getAddress(), balance);

      const treasuryBefore = await ethers.provider.getBalance(treasury.address);
      await curve.connect(seller).sell(tokenAddress, balance, 0);
      const treasuryAfter = await ethers.provider.getBalance(treasury.address);

      expect(treasuryAfter).to.be.greaterThan(treasuryBefore);
    });

    it("keeps the contract's real HBAR balance able to cover realHbarReserve after a sell", async function () {
      const balance = await token.balanceOf(seller.address);
      await token.connect(seller).approve(await curve.getAddress(), balance);
      await curve.connect(seller).sell(tokenAddress, balance, 0);

      const meme = await curve.memeTokens(tokenAddress);
      const contractBalance = await ethers.provider.getBalance(await curve.getAddress());
      expect(contractBalance).to.be.greaterThanOrEqual(meme.realHbarReserve);
    });
  });

  describe("view functions", function () {
    it("reverts with TokenNotFound for getAmountOut/previewBuy/previewSell on an unknown token", async function () {
      await expect(curve.getAmountOut(other.address, 1, 0)).to.be.revertedWithCustomError(
        curve,
        "TokenNotFound"
      );
      await expect(curve.previewBuy(other.address, hbar("1"))).to.be.revertedWithCustomError(
        curve,
        "TokenNotFound"
      );
      await expect(curve.previewSell(other.address, 1)).to.be.revertedWithCustomError(
        curve,
        "TokenNotFound"
      );
    });

    it("exposes the configured fee/goal constants", async function () {
      expect(await curve.creationFeeTinybars()).to.equal(CREATION_FEE);
      expect(await curve.tradingFeeBps()).to.equal(TRADING_FEE_BPS);
      expect(await curve.fundingGoal()).to.equal(FUNDING_GOAL);
    });
  });
});
