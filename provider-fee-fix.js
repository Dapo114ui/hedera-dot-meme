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
// With that masking gone, the real failure turned out to be a gas limit
// problem: the SDK hardcodes gas: 400000n for token creation (memeJob),
// which is LESS than the 750000n it hardcodes for plain HTS associate/
// approve calls, even though creating a brand new HTS token is a heavier
// operation than either of those. There's no public option to raise it
// from our code either, so we bump the gas field on outgoing
// eth_sendTransaction calls up to a safe floor when the SDK's requested
// limit is lower - unused gas on Hedera (as on Ethereum) is simply not
// spent, so this only removes headroom problems, it doesn't cost more.
const MIN_SAFE_GAS = 1000000n;

function withSafeGasFloor(tx) {
    if (!tx || typeof tx.gas !== 'string') return tx;
    try {
        if (BigInt(tx.gas) >= MIN_SAFE_GAS) return tx;
    } catch {
        return tx;
    }
    return { ...tx, gas: '0x' + MIN_SAFE_GAS.toString(16) };
}

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
                    if (args?.method === 'eth_sendTransaction' && args.params?.[0]) {
                        return target.request({
                            ...args,
                            params: [withSafeGasFloor(args.params[0]), ...args.params.slice(1)]
                        });
                    }
                    if (args?.method === 'wallet_sendTransaction') {
                        return target.request({
                            ...args,
                            method: 'eth_sendTransaction',
                            params: args.params?.[0] ? [withSafeGasFloor(args.params[0]), ...args.params.slice(1)] : args.params
                        });
                    }
                    return target.request(args);
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}
