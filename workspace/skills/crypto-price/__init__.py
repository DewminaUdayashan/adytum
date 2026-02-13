
import requests

def crypto_price(token_name: str) -> dict:
    """
    Get the current market price of a crypto token.
    """
    try:
        # Using CoinGecko API for crypto prices
        url = f"https://api.coingecko.com/api/v3/simple/price?ids={token_name.lower()}&vs_currencies=usd"
        response = requests.get(url)
        response.raise_for_status()  # Raise an exception for HTTP errors
        data = response.json()

        if token_name.lower() in data and 'usd' in data[token_name.lower()]:
            price = data[token_name.lower()]['usd']
            return {"token": token_name, "price": f"${price} USD"}
        else:
            # Try to search for the token if exact match not found
            search_url = f"https://api.coingecko.com/api/v3/search?query={token_name}"
            search_response = requests.get(search_url)
            search_response.raise_for_status()
            search_data = search_response.json()

            if search_data and search_data['coins']:
                first_coin_id = search_data['coins'][0]['id']
                # Fetch price for the found coin ID
                price_url = f"https://api.coingecko.com/api/v3/simple/price?ids={first_coin_id}&vs_currencies=usd"
                price_response = requests.get(price_url)
                price_response.raise_for_status()
                price_data = price_response.json()

                if first_coin_id in price_data and 'usd' in price_data[first_coin_id]:
                    price = price_data[first_coin_id]['usd']
                    return {"token": token_name, "price": f"${price} USD (found as {first_coin_id})"}
                else:
                    return {"error": f"Could not find price for {token_name}."}
            else:
                return {"error": f"Could not find {token_name} or its price."}

    except requests.exceptions.RequestException as e:
        return {"error": f"Failed to fetch crypto price: {e}"}
    except Exception as e:
        return {"error": f"An unexpected error occurred: {e}"}
