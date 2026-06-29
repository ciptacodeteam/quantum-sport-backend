# Analytics APIs - Quick Reference Card

## 🚀 Quick Start

```bash
# Backend must be running
bun run dev

# Test endpoints with cURL
curl -X GET "http://localhost:8787/admin/analytics/income-by-source" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 📊 API Endpoints

### 1️⃣ Income by Source

```
GET /admin/analytics/income-by-source
Query: startDate?, endDate?
Returns: Revenue breakdown (online/cashier/class/membership)
```

### 2️⃣ Payment Methods

```
GET /admin/analytics/payment-methods
Query: startDate?, endDate?
Returns: Payment method adoption & revenue
```

### 3️⃣ Business Insights

```
GET /admin/analytics/business-insights
Query: startDate?, endDate?
Returns: Complete KPI dashboard (courts, coaches, inventory, etc.)
```

### 4️⃣ Bulk Export

```
GET /admin/analytics/export/bulk-data
Query: type (courts|inventory|coach-bookings), startDate?, endDate?
Returns: Excel file (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
```

## 🔐 Authentication

- **Required**: ADMIN or ADMIN_VIEWER role
- **Format**: `Authorization: Bearer <token>`
- **Header**: Add to all requests

## 📅 Date Parameters

```
Format: ISO 8601 (YYYY-MM-DDTHH:mm:ssZ)
Example: 2024-12-19T00:00:00Z

Default (if not provided): Last 30 days
```

## 📝 Response Format

```json
// Success (200)
{
  "error": false,
  "data": { /* endpoint-specific data */ }
}

// Error (4xx/5xx)
{
  "error": true,
  "message": "Error description",
  "status": 400
}
```

## 💻 Code Examples

### Income by Source

```javascript
// Last 30 days
fetch('/admin/analytics/income-by-source', {
  headers: { Authorization: `Bearer ${token}` },
})
  .then((r) => r.json())
  .then((res) => console.log(res.data.summary))

// Custom date range
const startDate = new Date('2024-12-01').toISOString()
const endDate = new Date('2024-12-31').toISOString()
fetch(
  `/admin/analytics/income-by-source?startDate=${startDate}&endDate=${endDate}`,
  {
    headers: { Authorization: `Bearer ${token}` },
  },
)
```

### Download Export

```javascript
// Download as file
fetch('/admin/analytics/export/bulk-data?type=coach-bookings', {
  headers: { Authorization: `Bearer ${token}` },
})
  .then((r) => r.blob())
  .then((blob) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'coach-bookings.xlsx'
    a.click()
  })
```

## 🧪 Testing

Use Postman or cURL with the examples in `ANALYTICS_SETUP_GUIDE.md`.

## 📚 Documentation Files

| File                       | Purpose                |
| -------------------------- | ---------------------- |
| `ANALYTICS_APIS.md`        | Complete API reference |
| `ANALYTICS_SETUP_GUIDE.md` | Setup & testing guide  |

## 🔧 File Structure

```
src/
├── services/
│   └── analytics.service.ts       ← Business logic
├── handlers/admin/
│   └── analytics.handler.ts       ← Request handlers
├── routes/admin/
│   └── analytics.route.ts         ← Route definitions
└── app.ts                         ← Route mounting
```

## ⚡ Performance Tips

- Use date ranges to limit data (don't query all history)
- Exports work best with < 10k records
- Cache results client-side when appropriate
- Batch multiple analytics calls

## 🐛 Common Issues

| Issue            | Solution                             |
| ---------------- | ------------------------------------ |
| 401 Unauthorized | Check auth token, verify ADMIN role  |
| Empty results    | Verify date range includes data      |
| 400 Bad Date     | Use ISO format: 2024-12-19T00:00:00Z |
| Export corrupted | Try different browser or clear cache |
| Slow query       | Add date range to limit results      |

## 🎯 What Data Each Endpoint Returns

### Income by Source

- Total income by source
- Transaction counts
- Individual transactions with amounts

### Payment Methods

- Revenue per payment method
- Market share percentages
- Transaction counts

### Business Insights

- Court utilization rates
- Top performing courts
- Coach activity metrics
- Inventory usage stats
- Membership health metrics
- Booking confirmation rates
- Revenue analytics

### Bulk Export

- Courts: ID, name, cost, status
- Inventory: ID, name, quantity, value
- Coach Bookings: Booking, coach, customer, amount

## 🚀 Deployment

```bash
# Build
bun run build

# Test in staging
npm run test:analytics

# Deploy to production
# (Your deployment process here)
```

## 📊 Use Cases

### Revenue Analysis

- Use Income by Source to track channel performance
- Use Payment Methods to optimize payments

### Operations Dashboard

- Use Business Insights for daily KPIs
- Monitor court utilization
- Track coach activity

### Reporting

- Use Bulk Export for monthly reports
- Create Excel-based dashboards
- Share data with stakeholders

### Decision Making

- Compare court performance
- Identify growth opportunities
- Track membership trends
- Optimize inventory

## 🔔 Monitoring

```javascript
// Monitor endpoint performance
async function monitorAnalytics() {
  const start = Date.now()
  const res = await fetch('/admin/analytics/business-insights', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const time = Date.now() - start

  console.log(`Response: ${time}ms`)
  if (time > 5000) console.warn('Slow query!')
}
```

## 📞 Support

Check the documentation files or review the code:

- `src/services/analytics.service.ts` - Business logic
- `src/handlers/admin/analytics.handler.ts` - Handler implementation

---

**Status**: ✅ Production Ready | **Last Updated**: December 2024
