import { synthetic } from './fixtures'
import type { AmazonStore } from '../src/lib/amazon'
export const amazonState = structuredClone(synthetic)
amazonState.payees.push({ id: 'amazon', name: 'amazon.ca' })
amazonState.queue[0] = { ...amazonState.queue[0]!, payee_id: 'amazon', payee_name: 'amazon.ca', import_payee_name: 'AMZN MKTP CA', import_payee_name_original: 'AMZN MKTP CA', amount: -33600 }
export const amazonRecords: AmazonStore = {
  payments: [{ id: 'synthetic-payment', marketplace: 'amazon.ca', date: '2026-09-07', amount: -33600, refund: false, currency: 'CAD', payment_method: 'Visa ending in 0000', order_ids: ['000-0000000-0000001'], evidence: 'September 7, 2026 · Visa ending in 0000 · Charge CA$33.60 · Order 000-0000000-0000001' }],
  orders: [{ id: '000-0000000-0000001', marketplace: 'amazon.ca', url: 'https://www.amazon.ca/gp/your-account/order-details?orderID=000-0000000-0000001', date: '2026-09-05', currency: 'CAD', total: 33600, payment_method: 'Visa ending in 0000', fetched_at: '2026-09-09T21:00:00Z',
    items: [
      { id: 'cable', title: 'USB-C Charging Cable', quantity: 2, unit_price: 10000, price_text: 'CA$10.00', image: '', product_url: '', seller: 'Sold by: Synthetic Supply', status: 'Delivered September 8', details: 'Black · 2 metres' },
      { id: 'notebook', title: 'Ruled Notebook', quantity: 1, unit_price: 10000, price_text: 'CA$10.00', image: '', product_url: '', seller: 'Sold by: Synthetic Stationery', status: 'Delivered September 8', details: 'Blue · 120 pages' },
    ], totals: [{ label: 'Item(s) Subtotal:', value: 'CA$30.00' }, { label: 'Shipping & Handling:', value: 'CA$0.00' }, { label: 'Estimated tax:', value: 'CA$3.60' }, { label: 'Grand Total:', value: 'CA$33.60' }],
  }],
}
