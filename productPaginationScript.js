// Import node-fetch for making HTTP requests
// You'll need to install it: npm install node-fetch@2
// Note: node-fetch v2 is used for CommonJS compatibility in older Node.js environments.
// For Node.js 18+, you can use the built-in fetch or node-fetch v3+ with ESM.
import fetch from 'node-fetch'; // For Node.js < 18, use require('node-fetch') or configure ESM.
import 'dotenv/config'; // Import dotenv to load environment variables
import axios from 'axios'; // Import axios for making HTTP requests
import qs from 'qs'; // Import qs for query string serialization

const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_SHOP; // Using SHOPIFY_SHOP from .env
const SHOPIFY_STOREFRONT_ACCESS_TOKEN = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN; // Using SHOPIFY_STOREFRONT_ACCESS_TOKEN from .env

const API_ENDPOINT = `https://${SHOPIFY_STORE_DOMAIN}/api/2023-10/graphql.json`; // Adjust API version as needed
const PRODUCTS_PER_PAGE = 20; // Maximum allowed by Shopify is 250 for products, but 100 is a safe default.


const PRODUCTS_QUERY = `
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          title
          handle
          vendor
          description
          featuredImage {
            originalSrc # Changed from 'src' to 'originalSrc' for full resolution image URL
          }
          variants(first: 10) { # Fetching first 10 variants to get SKUs
            edges {
              node {
                id
                title
                sku
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

/**
 * Fetches all products from Shopify using GraphQL pagination.
 * For each product, it logs its ID, title, SKU of its first variant,
 * description, and featured image URL.
 * It also sends product data to a Google Sheet API.
 */
async function fetchAllProducts() {
  let allProducts = [];
  let hasNextPage = true;
  let cursor = null;
  let productCount = 0;

  console.log('Starting to fetch products...');

  try {
    do {
      const variables = {
        first: PRODUCTS_PER_PAGE,
        after: cursor,
      };

      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': SHOPIFY_STOREFRONT_ACCESS_TOKEN,
        },
        body: JSON.stringify({
          query: PRODUCTS_QUERY,
          variables: variables,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
      }

      const result = await response.json();

      if (result.errors) {
        console.error('GraphQL Errors:', JSON.stringify(result.errors, null, 2));
        throw new Error('GraphQL query failed.');
      }

      const productsData = result.data.products;
      const currentBatchProducts = productsData.edges.map(edge => edge.node);
      allProducts = allProducts.concat(currentBatchProducts);

      let productsSKUs = currentBatchProducts.map(product => {
        const firstVariant = product.variants.edges[0];
        return firstVariant ? {
          id: product.id,
          title: product.title,
          artist: product.vendor,
          CatNo: firstVariant.node.sku,
          description: product.description,
          featuredImage: product.featuredImage ? product.featuredImage.originalSrc : 'N/A' // Changed to originalSrc here
        } : {
          id: product.id,
          title: product.title,
          artist: product.vendor,
          CatNo: 'N/A',
          description: product.description, // Include description even if no variant
          featuredImage: product.featuredImage ? product.featuredImage.originalSrc : 'N/A' // Include image even if no variant
        };
      });

      // Prepare parameters for Google Sheets API
      const params = {
        id: '19i1SC338ULLnNBVhcYuY9yht0eGaEFEPzZxzwxedIRI',
        sheet: 'shopify-listed',
        range: 'A2:Z10000'
      };

      const queryString = qs.stringify(params);

      // Delete existing data in the sheet before posting new data
      // console.log('Deleting existing data in Google Sheet...');
      await axios.post(`https://google-sheets.onrender.com/data?id=19i1SC338ULLnNBVhcYuY9yht0eGaEFEPzZxzwxedIRI&sheet=shopify-listed`, productsSKUs );
      await new Promise(resolve => setTimeout(resolve, 1000)); // Delay to avoid hitting rate limits

      // --- Process Each Product in the Current Batch (for console logging) ---
      for (const product of currentBatchProducts) {
        productCount++;
        const firstVariantSku = product.variants.edges.length > 0
          ? product.variants.edges[0].node.sku
          : 'N/A';
        const imageUrl = product.featuredImage ? product.featuredImage.originalSrc : 'No featured image';
        const description = product.description || 'No description';

       
      }
      // --- End Process Each Product ---

      hasNextPage = productsData.pageInfo.hasNextPage;
      cursor = productsData.pageInfo.endCursor;

      if (hasNextPage) {
        console.log(`Fetched ${currentBatchProducts.length} products. Total fetched: ${allProducts.length}. Fetching next batch...`);
      } else {
        console.log(`Finished fetching all products. Total products retrieved: ${allProducts.length}`);
      }

    } while (hasNextPage);

  } catch (error) {
    console.error('Error fetching products:', error);
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Error Response Data:', error.response.data);
      console.error('Error Response Status:', error.response.status);
      console.error('Error Response Headers:', error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('Error Request:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error Message:', error.message);
    }
  }
}

// Execute the function
fetchAllProducts();
