const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BondingCurveMath", function () {
  let harness;

  beforeEach(async function () {
    const Harness = await ethers.getContractFactory("BondingCurveMathHarness");
    harness = await Harness.deploy();
  });

  describe("quote", function () {
    it("matches the constant-product formula by hand", async function () {
      // reserveIn=1000, reserveOut=2000, amountIn=100
      // amountOut = reserveOut*amountIn/(reserveIn+amountIn) = 2000*100/1100 = 181 (floor)
      const out = await harness.quote(1000n, 2000n, 100n);
      expect(out).to.equal(181n);
    });

    it("returns 0 for a zero amountIn", async function () {
      expect(await harness.quote(1000n, 2000n, 0n)).to.equal(0n);
    });

    it("reverts with ZeroReserve when reserveIn is 0", async function () {
      await expect(harness.quote(0n, 2000n, 100n)).to.be.revertedWithCustomError(
        harness,
        "ZeroReserve"
      );
    });

    it("reverts with ZeroReserve when reserveOut is 0", async function () {
      await expect(harness.quote(1000n, 0n, 100n)).to.be.revertedWithCustomError(
        harness,
        "ZeroReserve"
      );
    });

    it("is monotonically increasing in amountIn", async function () {
      const small = await harness.quote(1_000_000n, 2_000_000n, 1000n);
      const big = await harness.quote(1_000_000n, 2_000_000n, 2000n);
      expect(big).to.be.greaterThan(small);
    });

    it("has diminishing marginal output as amountIn grows (price impact)", async function () {
      const reserveIn = 1_000_000n;
      const reserveOut = 1_000_000n;
      const out1 = await harness.quote(reserveIn, reserveOut, 100_000n);
      const out2 = await harness.quote(reserveIn, reserveOut, 200_000n);
      // Doubling the input should yield less than double the output once
      // there's meaningful reserve depletion - that's the whole point of
      // a bonding curve (buying more moves price against you).
      expect(out2).to.be.lessThan(out1 * 2n);
    });

    it("never returns more than reserveOut even for a huge amountIn", async function () {
      const out = await harness.quote(1000n, 2000n, 10_000_000_000n);
      expect(out).to.be.lessThan(2000n);
    });

    it("round-trip (buy then sell) never profits the trader - rounds in the protocol's favor", async function () {
      // Simulates: start with reserves (H, T). Spend `hbarIn` to get
      // `tokensOut`. Immediately sell `tokensOut` back at the NEW
      // reserves. The HBAR recovered must never exceed the original
      // hbarIn, or the curve would be exploitable via pure rounding.
      const H = 300_000_000_000n; // 300 HBAR in weibars-ish test units
      const T = 800_000_000_00000000n; // 800M tokens, 8 decimals
      const hbarIn = 5_000_000_000n; // 5 HBAR

      const tokensOut = await harness.quote(H, T, hbarIn);
      const newH = H + hbarIn;
      const newT = T - tokensOut;

      const hbarRecovered = await harness.quote(newT, newH, tokensOut);
      expect(hbarRecovered).to.be.lessThanOrEqual(hbarIn);
    });
  });

  describe("applyFee", function () {
    it("splits 1% (100 bps) correctly", async function () {
      const [afterFee, fee] = await harness.applyFee(10_000n, 100);
      expect(fee).to.equal(100n);
      expect(afterFee).to.equal(9900n);
    });

    it("takes no fee at 0 bps", async function () {
      const [afterFee, fee] = await harness.applyFee(12345n, 0);
      expect(fee).to.equal(0n);
      expect(afterFee).to.equal(12345n);
    });

    it("takes the full amount at 10000 bps (100%)", async function () {
      const [afterFee, fee] = await harness.applyFee(12345n, 10000);
      expect(fee).to.equal(12345n);
      expect(afterFee).to.equal(0n);
    });

    it("afterFee + fee always equals the original amount (no dust lost)", async function () {
      const [afterFee, fee] = await harness.applyFee(987654321n, 137);
      expect(afterFee + fee).to.equal(987654321n);
    });

    it("rounds the fee down, never up, on small amounts", async function () {
      // amount=1, feeBps=100 (1%): 1*100/10000 = 0.01 -> floors to 0
      const [afterFee, fee] = await harness.applyFee(1n, 100);
      expect(fee).to.equal(0n);
      expect(afterFee).to.equal(1n);
    });
  });
});
