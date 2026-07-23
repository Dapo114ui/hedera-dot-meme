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
                    return target.request(args);
                };
            }
            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
        }
    });
}
