# Management customers

Management is a customer category, not a staff role. Only ADMIN and SUPER_ADMIN may create a Management customer or change its classification/dates. CASHIER may book for an eligible customer but cannot grant Management privileges or edit tariff settings. The generic customer edit API only writes the existing contact fields.

## Deployment

Apply the additive SQL before deploying the new backend (its Prisma user queries read the new fields):

```sh
bun run db:management-customers
bun run db:generate
```

The SQL is idempotent and leaves existing customers regular; all Management prices start unset. No existing invoices or packages are repriced.

## Admin workflow

1. In Kelola Kustomer, choose **Buat pelanggan Management**, or open an existing customer and enable **Kategori Management**. Optional date bounds are inclusive, based on the playing date in WIB. Existing phone numbers cannot create another account.
2. In Pengaturan Jam & Tarif, select a branch, sport and effective date. Enable **Tarif Management**, then enter the final court and coach prices per hour. Both are required together; zero explicitly means free. Only ADMIN/SUPER_ADMIN can save tariff settings.
3. Book a court from the dashboard, select that customer, and choose direct in-house coaching. **Tarif Management** appears on each eligible session. Extra participants remain Rp100,000/person/hour from the second person.
4. Checkout reads classification from the database and computes prices from the effective branch/sport tariff. It rejects stale `expectedTotal` quotes. Invoice, court detail and coach line store the final charged amounts; coach description records Management.

The rate does not apply to public website checkout, club coaches, court membership usage, recurring Value Pack reservations, or prepaid in-house wallet redemption. No order promo is accepted by admin checkout. If a customer is regular, outside their validity period, or there is no paired Management tariff for the session, regular pricing applies. Public tariff responses omit Management price fields. Historic reports keep using recorded invoice amounts and exclude in-house fees from club payables as before.
