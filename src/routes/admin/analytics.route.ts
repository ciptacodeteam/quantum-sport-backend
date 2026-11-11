import {
  courtPerformanceHandler,
  courtPerformanceExportHandler,
} from '@/handlers/admin/court-performance.handler'
import { createRouter } from '@/lib/create-app'
import {
  serviceIncomeHandler,
  serviceIncomeExportHandler,
} from '@/handlers/admin/service-income.handler'
import {
  exportAnalyticsToExcelHandler,
  getAnalyticsHandler,
  getDashboardStatsHandler,
  getDailyTransactionsHandler,
  getIncomeBySourceHandler,
  exportIncomeBySourceHandler,
  getPaymentMethodsHandler,
  getBusinessInsightsHandler,
  exportBulkDataHandler,
} from '@/handlers/admin/analytics.handler'

const adminAnalyticsRoute = createRouter()
  .basePath('/analytics')
  .get('/coach-ballboy-income', ...serviceIncomeHandler)
  .get('/coach-ballboy-income/export', ...serviceIncomeExportHandler)
  .get('/', ...getAnalyticsHandler)
  .get('/court-performance', ...courtPerformanceHandler)
  .get('/court-performance/export', ...courtPerformanceExportHandler)
  .get('/dashboard', ...getDashboardStatsHandler)
  .get('/daily-transactions', ...getDailyTransactionsHandler)
  .get('/income-by-source', ...getIncomeBySourceHandler)
  .get('/income-by-source/export', ...exportIncomeBySourceHandler)
  .get('/payment-methods', ...getPaymentMethodsHandler)
  .get('/business-insights', ...getBusinessInsightsHandler)
  .get('/export/excel', ...exportAnalyticsToExcelHandler)
  .get('/export/bulk-data', ...exportBulkDataHandler)

export default adminAnalyticsRoute
