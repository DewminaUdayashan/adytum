---
name: Crypto Price
description: Get the current market price of a crypto token.
---

# Crypto Price Skill

Use `crypto_price` to fetch the current market price of a crypto token. Requires internet access.

## Usage

Call the tool with the token id/symbol (as CoinGecko ids work best) and optional fiat:

- `crypto_price(token="bitcoin", fiat="usd")`
- `crypto_price(token="eth", fiat="eur")`

If fiat is omitted it defaults to `usd`.
