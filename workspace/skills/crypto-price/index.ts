import { z } from 'zod';

const schema = z.object({
  token: z.string().describe('Ticker or name, e.g., btc, eth, bitcoin, sol'),
  fiat: z.string().default('usd').describe('Fiat currency for quote (usd/eur/gbp/etc)'),
});

type Params = z.infer<typeof schema>;

export default {
  id: 'crypto-price',
  name: 'Crypto Price',
  description: 'Fetch the current price for a crypto asset via CoinGecko.',

  register(api: any) {
    api.registerTool({
      name: 'crypto_price',
      description: 'Get the current market price of a crypto token.',
      parameters: schema,
      execute: async ({ token, fiat }: Params) => {
        const base = 'https://api.coingecko.com/api/v3/simple/price';
        const qs = new URLSearchParams({
          ids: token,
          vs_currencies: fiat,
        }).toString();
        const url = `${base}?${qs}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          throw new Error(`CoinGecko error ${res.status}`);
        }
        const data = (await res.json()) as Record<string, Record<string, number>>;
        const value = data[token]?.[fiat];
        if (value === undefined) {
          throw new Error(`No price for ${token} in ${fiat}`);
        }
        return { token, fiat, price: value };
      },
    });
  },
};
