import {
  courtPerformanceHandler,
  courtPerformanceExportHandler,
} from '@/handlers/admin/court-performance.handler'
import { createRouter } from '@/lib/create-app'
import {
  exportAnalyticsToExcelHandler,
  getAnalyticsHandler,
  getDashboardStatsHandler,
  getDailyTransactionsHandler,
  getIncomeBySourceHandler,
  getPaymentMethodsHandler,
  getBusinessInsightsHandler,
  exportBulkDataHandler,
} from '@/handlers/admin/analytics.handler'

const adminAnalyticsRoute = createRouter()
  .basePath('/analytics')
  .get('/', ...getAnalyticsHandler)
  .get('/court-performance', ...courtPerformanceHandler)
  .get('/court-performance/export', ...courtPerformanceExportHandler)
  .get('/dashboard', ...getDashboardStatsHandler)
  .get('/daily-transactions', ...getDailyTransactionsHandler)
  .get('/income-by-source', ...getIncomeBySourceHandler)
  .get('/payment-methods', ...getPaymentMethodsHandler)
  .get('/business-insights', ...getBusinessInsightsHandler)
  .get('/export/excel', ...exportAnalyticsToExcelHandler)
  .get('/export/bulk-data', ...exportBulkDataHandler)

export default adminAnalyticsRoute
