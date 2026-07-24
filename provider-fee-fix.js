// viem (used internally by the memejob SDK's EvmAdapter) tries to estimate
// EIP-1559 fees via eth_maxPriorityFeePerGas whenever a transaction doesn't
// specify gasPrice/maxFeePerGas explicitly - and the SDK's writeContract
// calls never do. HashPack's injected provider throws "The Provider does
// not support the requested method" for this, which the SDK has no public
// option to work around (create()/buy()/sell() don't expose a way to pass
// fee overrides through to the underlying transaction).
//
// Hedera's fee model doesn't have Ethereum-style priority tipping anyway,
// so stubbing these two RPC methods to "no priority fee" is a safe,
// honest answer - everything else passes through to the real provider
// unchanged, via a Proxy so other methods/properties (event listeners,
// etc.) keep working normally.
//
// Separately, viem's sendTransaction() has a quirk: if the wallet's
// eth_sendTransaction call fails with an error it classifies as
// "method/input not supported" (which includes the generic -32000
// "Invalid input" range - the bucket HashPack uses for real transaction
// failures too), viem silently retries via wallet_sendTransaction to see
// if that namespace works instead. HashPack doesn't implement
// wallet_sendTransaction at all, so that retry always fails with its own
// "Unsupported method" error - and viem surfaces THAT instead of the
// original failure, hiding the real reason the transaction didn't go
// through. Forwarding wallet_sendTransaction straight to the real
// eth_sendTransaction makes that retry a harmless no-op, so whatever
// actually caused the transaction to fail is what reaches the user.
//
// NOTE on gas: an earlier version of this file bumped the SDK's gas limit,
// on the theory that the "Transaction failed" rejections were out-of-gas.
// That was wrong and has been removed. A successful launch's receipt showed
// only ~382k gas actually used, which fits the SDK's hardcoded 400k limit
// fine. Worse, raising the limit costs real money on Hedera: the network
// refunds at most 20% of unused gas (maxRefundPercentOfGasLimit), so a
// larger limit is charged at ~80% of the limit regardless of usage, and
// that inflated fee - reserved up front against the payer's balance
// together with the ~19 HBAR call value - is what actually triggered the
// INSUFFICIENT_PAYER_BALANCE rejections HashPack reports as "Transaction
// failed". We now leave the SDK's gas untouched.
export function wrapProviderForLegacyFees(provider) {
    if (!provider || typeof provider.request !== 'function') return provider;

    return new Proxy(provider, {
        get(target, prop, receiver) {
            if (prop === 'request') {
                return async (args) => {
                    if (args?.method === 'eth_maxPriorityFeePerGas') {
                        return '0x0';
                    }
                    if (args?.method === 'eth_feeHistory') {
                        const blockCount = parseInt(args.params?.[0], 16) || 1;
                        return {
                            oldestBlock: '0x1',
                            baseFeePerGas: Array(blockCount + 1).fill('0x0'),
                            gasUsedRatio: Array(blockCount).fill(0),
                            reward: Array(blockCount).fill(['0x0'])
                        };
                    }
                    if (args?.method === 'wallet_sendTransaction') {
                        return target.request({ ...args, method: 'eth_sendTransaction' });
                    }
                    return target.request(args);
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}
