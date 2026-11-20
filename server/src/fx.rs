// Daily USD→CAD rates from the Bank of Canada, used to suggest Amazon payments
// charged in US dollars. Only the requested date range leaves this machine.
use chrono::{Duration as Days, NaiveDate, Utc};
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    sync::LazyLock,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

const SOURCE: &str = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json";
const REFRESH: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Default)]
struct Cache {
    start: Option<NaiveDate>,
    fetched: Option<Instant>,
    rates: BTreeMap<String, f64>,
}
static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(Cache::default()));

#[derive(Deserialize)]
struct Valet {
    observations: Vec<Observation>,
}
#[derive(Deserialize)]
struct Observation {
    d: String,
    #[serde(rename = "FXUSDCAD")]
    rate: Option<Value>,
}
#[derive(Deserialize)]
struct Value {
    v: String,
}

/// Rates from `start` (YYYY-MM-DD) through today, keyed by date.
pub async fn usd_cad(start: &str) -> Result<BTreeMap<String, f64>, String> {
    let today = Utc::now().date_naive();
    let start = NaiveDate::parse_from_str(start, "%Y-%m-%d")
        .map_err(|_| "Invalid start date")?
        // The series begins in 2017; keep requests bounded.
        .clamp(NaiveDate::from_ymd_opt(2017, 1, 3).unwrap(), today)
        // Include a week before the start so a weekend or holiday still has a rate.
        - Days::days(7);
    let mut cache = CACHE.lock().await;
    let fresh = cache.fetched.is_some_and(|f| f.elapsed() < REFRESH);
    if !fresh || cache.start.is_none_or(|s| s > start) {
        let from = cache
            .start
            .filter(|_| fresh)
            .map_or(start, |s| s.min(start));
        let response = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|_| "Exchange rates unavailable")?
            .get(SOURCE)
            .query(&[
                ("start_date", from.to_string()),
                ("end_date", today.to_string()),
            ])
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|_| "Exchange rates unavailable")?;
        let body: Valet = response
            .json()
            .await
            .map_err(|_| "Exchange rates unavailable")?;
        let rates: BTreeMap<String, f64> = body
            .observations
            .into_iter()
            .filter(|o| NaiveDate::parse_from_str(&o.d, "%Y-%m-%d").is_ok())
            .filter_map(|o| Some((o.d, o.rate?.v.parse::<f64>().ok()?)))
            .filter(|(_, r)| r.is_finite() && (0.5..3.0).contains(r))
            .collect();
        *cache = Cache {
            start: Some(from),
            fetched: Some(Instant::now()),
            rates,
        };
    }
    Ok(cache
        .rates
        .range(start.to_string()..)
        .map(|(d, r)| (d.clone(), *r))
        .collect())
}
