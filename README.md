# Deep Link Tester

Small Node.js web server for testers to launch and verify Trade App deep links across SIT, UAT, and PROD.

## Run

```bash
yarn start
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/api/deep-links`

## Configure

Edit [`deep-links.config.json`](./deep-links.config.json) to change the environments and routes shown on the page.

Environment variables:

- `PORT` - server port, defaults to `3000`
- `DEEPLINK_SCHEME` - custom scheme prefix, defaults to the config file value
- `DEEPLINK_SCHEME_HOST` - custom scheme host, defaults to the config file value
- `DEEPLINK_SIT_WEB_HOST` - override SIT web host
- `DEEPLINK_UAT_WEB_HOST` - override UAT web host
- `DEEPLINK_PROD_WEB_HOST` - override PROD web host

Example:

```bash
PORT=4000 DEEPLINK_SCHEME=tradeapp DEEPLINK_SIT_WEB_HOST=staging.example.com DEEPLINK_PROD_WEB_HOST=www.placemakers.co.nz yarn start
```

## Notes

- `Launch` redirects to the selected environment and route.
- SIT and UAT use the `tradeapp://tradeapp/...` format from the guide.
- PROD uses the `/redirect` web base path on `https://www.placemakers.co.nz` and does not show a custom-scheme launch.
- Routes with variables such as order ID, order number, quote code, category ID, and SKU are editable in the top launcher form.
