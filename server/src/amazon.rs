use serde::{Deserialize, Serialize};
use zeroize::Zeroize;

#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
#[serde(default, deny_unknown_fields)]
pub struct Store {
    pub payments: Vec<Payment>,
    pub orders: Vec<Order>,
}
#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
pub struct Assignment {
    pub payment_id: String,
    pub transaction_id: String,
}
#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
#[serde(deny_unknown_fields)]
pub struct Payment {
    pub id: String,
    pub marketplace: String,
    pub date: String,
    pub amount: i64,
    pub currency: String,
    pub refund: bool,
    pub payment_method: String,
    pub order_ids: Vec<String>,
    pub evidence: String,
}
#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
#[serde(deny_unknown_fields)]
pub struct Order {
    pub id: String,
    pub marketplace: String,
    pub url: String,
    pub date: String,
    pub currency: String,
    pub total: Option<i64>,
    pub payment_method: String,
    pub items: Vec<Item>,
    pub totals: Vec<Total>,
    pub fetched_at: String,
}
#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
#[serde(deny_unknown_fields)]
pub struct Item {
    pub id: String,
    pub title: String,
    pub quantity: u32,
    pub unit_price: Option<i64>,
    pub price_text: String,
    pub product_url: String,
    pub image: String,
    pub seller: String,
    pub status: String,
    pub details: String,
}
#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
#[serde(deny_unknown_fields)]
pub struct Total {
    pub label: String,
    pub value: String,
}
fn marketplace(value: &str) -> bool {
    matches!(value, "amazon.ca" | "amazon.com")
}
fn date(value: &str) -> bool {
    value.is_empty()
        || (value.len() == 10 && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok())
}
fn order_id(value: &str) -> bool {
    value.len() == 19
        && value.bytes().enumerate().all(|(i, c)| {
            if i == 3 || i == 11 {
                c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
}
fn currency(value: &str) -> bool {
    matches!(value, "CAD" | "USD")
}
fn url(value: &str, market: &str) -> bool {
    value.is_empty()
        || reqwest::Url::parse(value).is_ok_and(|u| {
            u.scheme() == "https"
                && u.username().is_empty()
                && u.password().is_none()
                && u.port().is_none()
                && u.host_str()
                    .is_some_and(|h| h == market || h == format!("www.{market}"))
        })
}
impl Store {
    pub fn merge(&mut self, incoming: Store) -> Result<(), String> {
        if incoming.payments.len() > 100 || incoming.orders.len() > 1 {
            return Err("Amazon batch too large".into());
        }
        for p in &incoming.payments {
            if !marketplace(&p.marketplace)
                || !date(&p.date)
                || !currency(&p.currency)
                || p.id.is_empty()
                || p.id.len() > 100
                || p.amount == 0
                || p.amount.unsigned_abs() > 1_000_000_000_000
                || p.refund != (p.amount > 0)
                || p.payment_method.len() > 500
                || p.evidence.len() > 8000
                || p.order_ids.len() > 30
                || p.order_ids.iter().any(|id| !order_id(id))
            {
                return Err("Invalid Amazon payment".into());
            }
        }
        for o in &incoming.orders {
            if !marketplace(&o.marketplace)
                || !order_id(&o.id)
                || !date(&o.date)
                || !currency(&o.currency)
                || !url(&o.url, &o.marketplace)
                || o.url.len() > 2000
                || o.items.is_empty()
                || o.items.len() > 100
                || o.totals.len() > 50
                || o.payment_method.len() > 800
                || o.fetched_at.len() > 50
                || o.totals
                    .iter()
                    .any(|t| t.label.len() > 600 || t.value.len() > 600)
            {
                return Err("Invalid Amazon order".into());
            }
            for i in &o.items {
                let image_ok = i.image.is_empty()
                    || [
                        "data:image/jpeg;base64,",
                        "data:image/png;base64,",
                        "data:image/webp;base64,",
                    ]
                    .iter()
                    .any(|prefix| {
                        i.image.strip_prefix(prefix).is_some_and(|s| {
                            s.bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
                        })
                    });
                if i.id.len() > 100
                    || i.title.is_empty()
                    || i.title.len() > 4000
                    || i.quantity == 0
                    || i.quantity > 10000
                    || i.price_text.len() > 400
                    || i.seller.len() > 1200
                    || i.status.len() > 2400
                    || i.details.len() > 4800
                    || i.image.len() > 180000
                    || !image_ok
                    || !url(&i.product_url, &o.marketplace)
                    || i.product_url.len() > 2000
                {
                    return Err("Invalid Amazon item".into());
                }
            }
        }
        for p in incoming.payments {
            if let Some(old) = self
                .payments
                .iter_mut()
                .find(|old| old.id == p.id && old.marketplace == p.marketplace)
            {
                *old = p;
            } else {
                self.payments.push(p);
            }
        }
        for o in incoming.orders {
            if let Some(old) = self
                .orders
                .iter_mut()
                .find(|old| old.id == o.id && old.marketplace == o.marketplace)
            {
                *old = o;
            } else {
                self.orders.push(o);
            }
        }
        // Bound optional thumbnails without dropping the textual order evidence.
        let mut image_bytes: usize = self
            .orders
            .iter()
            .flat_map(|o| &o.items)
            .map(|i| i.image.len())
            .sum();
        let mut oldest: Vec<_> = (0..self.orders.len()).collect();
        oldest.sort_by(|a, b| self.orders[*a].fetched_at.cmp(&self.orders[*b].fetched_at));
        for index in oldest {
            if image_bytes <= 16 * 1024 * 1024 {
                break;
            }
            for item in &mut self.orders[index].items {
                image_bytes -= item.image.len();
                item.image.clear();
            }
        }
        if serde_json::to_vec(self)
            .map_err(|_| "Invalid Amazon records")?
            .len()
            > 64 * 1024 * 1024
        {
            return Err("Amazon cache full. Clear Amazon data before fetching more.".into());
        }
        // Fail transactionally in the caller; never silently evict evidence.
        if self.orders.len() > 5000 || self.payments.len() > 20000 {
            return Err("Amazon cache full. Clear Amazon data before fetching more.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn payment() -> Payment {
        Payment {
            id: "synthetic-payment".into(),
            marketplace: "amazon.ca".into(),
            date: "2026-09-01".into(),
            amount: -12000,
            currency: "CAD".into(),
            order_ids: vec!["000-0000000-0000001".into()],
            ..Default::default()
        }
    }
    #[test]
    fn imports_are_idempotent_and_preserve_refund_direction() {
        let mut store = Store::default();
        for _ in 0..2 {
            store
                .merge(Store {
                    payments: vec![payment()],
                    ..Default::default()
                })
                .unwrap();
        }
        assert_eq!(store.payments.len(), 1);
        let mut bad = payment();
        bad.refund = true;
        assert!(
            store
                .merge(Store {
                    payments: vec![bad],
                    ..Default::default()
                })
                .is_err()
        );
        assert_eq!(store.payments[0].amount, -12000);
    }
    #[test]
    fn rejects_foreign_urls_and_invalid_dates() {
        assert!(!url("https://www.amazon.ca.evil.test/order", "amazon.ca"));
        assert!(!url("https://user@amazon.ca/order", "amazon.ca"));
        assert!(!url("javascript:alert(1)", "amazon.ca"));
        let mut bad = payment();
        bad.date = "2026-02-30".into();
        assert!(
            Store::default()
                .merge(Store {
                    payments: vec![bad],
                    ..Default::default()
                })
                .is_err()
        );
    }
}
