import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fetch from 'node-fetch';
import csv from 'csv-parser';
import { MongoClient } from 'mongodb';

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_ADMIN_API_TOKEN;
const MONGO_URI = process.env.MONGO_URI;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const filePath = path.join(__dirname, 'shopify_multi_metafield_template.csv');

async function fetchProductId(handle) {
  const query = `
    {
      productByHandle(handle: "${handle}") {
        id
      }
    }
  `;
  const res = await fetch(`https://${SHOP}/admin/api/2023-07/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query }),
  });

  const json = await res.json();
  return json.data.productByHandle?.id || null;
}

async function updateDescription(productId, newHtml) {
  const mutation = `
    mutation {
      productUpdate(input: {
        id: "${productId}",
        bodyHtml: "${newHtml.replace(/"/g, '\\"')}"
      }) {
        product {
          id
          title
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const res = await fetch(`https://${SHOP}/admin/api/2023-07/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query: mutation }),
  });

  const json = await res.json();
  if (json.errors || json.data.productUpdate.userErrors.length) {
    console.error("❌ Description Update Errors:", json.errors || json.data.productUpdate.userErrors);
  } else {
    console.log("✅ Updated description for", productId);
  }
}

async function updateMetafields(productId, metafields) {
  const metafieldsInput = metafields.map(mf => `{
    ownerId: "${productId}",
    namespace: "custom",
    key: "${mf.key}",
    type: "${mf.type}",
    value: "${typeof mf.value === 'string' ? mf.value.replace(/"/g, '\\"') : JSON.stringify(mf.value).replace(/"/g, '\\"')}"
  }`).join(',');

  const mutation = `
    mutation {
      metafieldsSet(metafields: [${metafieldsInput}]) {
        metafields {
          id
          key
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const res = await fetch(`https://${SHOP}/admin/api/2023-07/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query: mutation }),
  });

  const json = await res.json();
  if (json.errors || json.data.metafieldsSet.userErrors.length) {
    console.error("❌ Metafield Errors:", json.errors || json.data.metafieldsSet.userErrors);
  } else {
    console.log("✅ Updated metafields for", productId);
  }
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('fpl-data');
  const albums = db.collection('albums');

  const rows = [];

  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (row) => rows.push(row))
    .on('end', async () => {
      for (const row of rows) {
        const handle = row.Handle;
        const productId = await fetchProductId(handle);

        if (!productId) {
          console.error("❌ Product not found:", handle);
          continue;
        }

        const metafields = [];

        if (row.Tracklist) {
          const tracklistArray = row.Tracklist.split('\n').map(line => line.trim()).filter(Boolean);
          metafields.push({ key: "tracklist", type: "list.single_line_text_field", value: tracklistArray });
        }
        if (row.Format)
          metafields.push({ key: "format", type: "single_line_text_field", value: row.Format });
        if (row.Label)
          metafields.push({ key: "label", type: "single_line_text_field", value: row.Label });
        if (row.ReleaseYear)
          metafields.push({ key: "release_year", type: "number_integer", value: parseInt(row.ReleaseYear, 10).toString() });

        await updateMetafields(productId, metafields);
      }

      console.log('🎉 All rows processed');
      await client.close();
    });
}

main().catch(console.error);
