import json
import os
import unittest
from unittest.mock import patch

from app.services.cross_chain_routes import (
    _word,
    _word_address,
    configured_destination_networks,
    load_destination_routes,
)


class CrossChainRouteTests(unittest.TestCase):
    def test_registry_is_authority_when_mirror_omits_executor_and_token(self):
        payload = json.dumps([{
            "network": "creditcoin-testnet",
            "routeId": "0x" + "11" * 32,
            "registry": "0x" + "22" * 20,
            "destinationChainId": 102031,
        }])
        with patch.dict(os.environ, {
            "TSN_DESTINATION_ROUTES_JSON": payload,
            "TSN_CREDITCOIN_RPC_URL": "https://rpc.cc3-testnet.creditcoin.network",
        }, clear=False):
            route = load_destination_routes()["creditcoin-testnet"]
            self.assertIsNone(route.executor)
            self.assertIsNone(route.token)

    def test_route_config_requires_exact_executor_and_token_fields(self):
        payload = json.dumps([{
            "network": "base",
            "routeId": "0x" + "11" * 32,
            "registry": "0x" + "22" * 20,
            "executor": "0x" + "33" * 20,
            "token": "0x" + "44" * 20,
            "destinationChainId": 8453,
        }])
        with patch.dict(os.environ, {
            "TSN_DESTINATION_ROUTES_JSON": payload,
            "TSN_CREDITCOIN_RPC_URL": "https://rpc.cc3-testnet.creditcoin.network",
        }, clear=False):
            routes = load_destination_routes()
            self.assertEqual(routes["base"].executor, "0x" + "33" * 20)
            self.assertEqual(routes["base"].token, "0x" + "44" * 20)
            self.assertEqual(configured_destination_networks()[0]["chainId"], 8453)

    def test_registry_words_decode_route_addresses(self):
        words = [
            "0".zfill(64),
            "1".zfill(64),
            ("00" * 12) + ("aa" * 20),
            ("00" * 12) + ("bb" * 20),
            ("00" * 12) + ("cc" * 20),
            "00" * 32,
            format(8453, "064x"),
            ("00" * 12) + ("dd" * 20),
            ("00" * 12) + ("ee" * 20),
        ]
        encoded = "0x" + "".join(words)
        self.assertEqual(_word(encoded, 0), 0)
        self.assertEqual(_word(encoded, 6), 8453)
        self.assertEqual(_word_address(encoded, 7), "0x" + "dd" * 20)
        self.assertEqual(_word_address(encoded, 8), "0x" + "ee" * 20)


if __name__ == "__main__":
    unittest.main()
