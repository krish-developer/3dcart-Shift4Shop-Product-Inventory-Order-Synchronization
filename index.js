const csv = require('csvtojson');
const axios = require('axios');

// Path to CSV to be imported
const CSV_FILE_PATH = './orders.csv';

// 3dcart API credentials
const { CART_API_URL, CART_STORE_URL, CART_PRIVATE_KEY, CART_TOKEN } = process.env;

// Custom note or tag to add to each imported order
const ORDER_NOTE = 'IMPORTED ORDER';
const ORDER_TAG = 'IMPORTED';

(async () => {
  // Import orders from CSV
  await importOrdersFromCSV(CSV_FILE_PATH);

  const thirdPartyApiUrl = '';
  await importOrdersFromAPI(thirdPartyApiUrl);

  // Sync products
  await syncProducts();

  // Sync inventory
  await syncInventory();
})();

async function importOrdersFromCSV(filePath) {
  try {
    const records = await csv().fromFile(filePath);

    if (!records || records.length === 0) {
      throw new Error(`Couldn't read records from CSV ${filePath}`);
    }

    console.log(`Read ${records.length} records from CSV ${filePath}`);

    const orders = processRecords(records);

    await uploadOrdersTo3dcart(orders);
  } catch (error) {
    console.error('Error during CSV order processing:', error.message);
  }
}

async function importOrdersFromAPI(apiUrl) {
  try {
    const { data: records } = await axios.get(apiUrl);

    if (!records || records.length === 0) {
      throw new Error(`No records retrieved from API ${apiUrl}`);
    }

    console.log(`Retrieved ${records.length} records from API ${apiUrl}`);

    const orders = processRecords(records);

    await uploadOrdersTo3dcart(orders);
  } catch (error) {
    console.error('Error during API order processing:', error.message);
  }
}

function processRecords(records) {
  const orders = {};

  records.forEach(record => {
    const orderName = record.email.replace(/[^\w]+/g, '_');

    if (!orders[orderName]) {
      orders[orderName] = {
        imported: false,
        order_name: orderName,
        email: record.email,
        phone: record.phone,
        billing_name: record.billing_name,
        billing_company: record.company,
        billing_address1: record.billing_address1,
        billing_address2: record.billing_address2 || null,
        billing_city: record.billing_city,
        billing_zip: record.billing_zip,
        billing_province: record.billing_province && record.billing_province.length === 2 ?
          record.billing_province : null,
        billing_country: record.billing_country,
        line_items: [
          {
            title: record.lineitem_title,
            sku: record.lineitem_sku,
            price: 0.00,
            quantity: parseInt(record.lineitem_quantity)
          }
        ],
        shipping_method: record.shipping_method,
        tags: ORDER_TAG,
        note_attributes: record.note_attributes
      };
    } else {
      orders[orderName].line_items.push({
        title: record.lineitem_title,
        sku: record.lineitem_sku,
        price: 0.00,
        quantity: parseInt(record.lineitem_quantity)
      });
    }
  });

  return Object.values(orders).filter(order => !order.imported);
}

async function uploadOrdersTo3dcart(ordersArr) {
  for (let i = 0; i < ordersArr.length; i++) {
    const order = ordersArr[i];
    console.log(`Uploading order ${i + 1}/${ordersArr.length} to 3dcart`);

    const customer = {
      BillingFirstName: order.billing_name.split(' ')[0],
      BillingLastName: order.billing_name.split(' ').slice(1).join(' '),
      BillingPhoneNumber: order.phone,
      BillingEmail: order.email
    };

    const address = {
      BillingAddress: order.billing_address1,
      BillingAddress2: order.billing_address2,
      BillingCity: order.billing_city,
      BillingZipCode: order.billing_zip,
      BillingState: order.billing_province,
      BillingCountry: order.billing_country,
    };

    const shipping = {
      ShippingMethod: order.shipping_method,
      ShippingHandling: 0.00
    };

    const lineItems = order.line_items.map(item => ({
      ProductName: item.title,
      CatalogID: item.sku,
      ItemPrice: item.price,
      Quantity: item.quantity
    }));

    const cartOrder = {
      OrderStatusID: 11, // Awaiting Fulfillment
      Customer: customer,
      OrderBillingAddress: address,
      OrderShippingAddress: address,
      OrderPaymentStatus: 'Paid',
      OrderShipping: shipping,
      OrderItemDetails: lineItems,
      OrderComments: order.note_attributes ? ORDER_NOTE + order.note_attributes : ORDER_NOTE,
      OrderTags: ORDER_TAG
    };

    try {
      const result = await uploadOrderTo3dcart(cartOrder);
      console.log(`Uploaded order ${i + 1}/${ordersArr.length} to 3dcart`);
    } catch (error) {
      console.error(`Failed to upload order ${i + 1}/${ordersArr.length}:`, error.response?.data || error.message);
    }

    await sleep(1000); // To avoid hitting API rate limits
  }
}

async function uploadOrderTo3dcart(order) {
  const url = `${CART_API_URL}/orders`;

  const config = {
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CART_TOKEN}`
    },
    data: order
  };

  const response = await axios(config);
  return response.data;
}

async function syncProducts() {
  try {
    const products = await getProductsFromAPI();
    for (const product of products) {
      await uploadProductTo3dcart(product);
    }
    console.log('Products synced successfully.');
  } catch (error) {
    console.error('Error during product sync:', error.message);
  }
}

async function getProductsFromAPI() {
  // Replace with the actual logic to retrieve products from your third-party API
  const apiUrl = '';
  const { data: products } = await axios.get(apiUrl);
  return products;
}

async function uploadProductTo3dcart(product) {
  const url = `${CART_API_URL}/products`;

  const config = {
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CART_TOKEN}`
    },
    data: {
      Name: product.name,
      SKU: product.sku,
      Price: product.price,
      Stock: product.stock,
      Description: product.description
    }
  };

  const response = await axios(config);
  return response.data;
}

async function syncInventory() {
  try {
    const inventory = await getInventoryFromAPI();
    for (const item of inventory) {
      await updateInventoryIn3dcart(item);
    }
    console.log('Inventory synced successfully.');
  } catch (error) {
    console.error('Error during inventory sync:', error.message);
  }
}

async function getInventoryFromAPI() {
  const apiUrl = '';
  const { data: inventory } = await axios.get(apiUrl);
  return inventory;
}

async function updateInventoryIn3dcart(item) {
  const url = `${CART_API_URL}/products/${item.sku}/inventory`;

  const config = {
    method: 'PUT',
    url,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CART_TOKEN}`
    },
    data: {
      Stock: item.stock
    }
  };

  const response = await axios(config);
  return response.data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
