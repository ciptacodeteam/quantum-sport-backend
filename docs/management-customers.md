# Management customers

Management is a customer category, not a staff role. Only ADMIN and SUPER_ADMIN may create a Management customer or change its classification, dates and account prices. CASHIER may book for an eligible customer but cannot grant Management privileges or edit tariff settings. The generic customer edit API only writes the existing contact fields.

## Deployment

Apply the additive SQL before deploying the new backend (its Prisma user queries read the new fields):

```sh
bun run db:management-customers
bun run db:generate
```

The SQL is idempotent and leaves existing customers regular; the two account prices default to zero (normal pricing). The Docker entrypoint applies this script automatically. Existing global Management tariff values are retained only for compatibility and are no longer used; configure each Management account explicitly. No existing invoices or packages are repriced.

## Admin workflow

1. In Kelola Kustomer, choose **Buat pelanggan Management**, or open an existing customer and enable **Kategori Management**. Optional date bounds are inclusive, based on the playing date in WIB. Existing phone numbers cannot create another account.
2. In **Kelola Kustomer → Detail Akun → Pengaturan Management**, enable the Management label and save the account's **Lapangan per jam** and **Coach In-house per jam**. Prices apply to all courts, branches and sports during that account's validity period. Each component is independent: **Rp0 means use normal pricing, never free**. A positive value replaces that component's normal hourly price. The old Management section has been removed from Pengaturan Jam & Tarif.
3. Book a court from the dashboard and select that customer. The Management court tariff applies even without a coach. Direct in-house coaching uses the account Management coach tariff when positive. **Tarif Management** appears on each eligible court session. Extra in-house participants remain Rp100,000/person/hour from the second person.
4. Checkout reads classification from the database and loads the saved account prices from the database; any zero component uses normal effective branch/sport pricing. It rejects stale `expectedTotal` quotes. Invoice, court detail and coach line store the final charged amounts; coach description records Management.

The rate does not apply to public website checkout, club coach fees, court membership usage, recurring Value Pack reservations, or prepaid in-house wallet redemption. With a club coach, the court uses the fixed Management tariff without another court bundle discount; coach fees are unchanged. Court charges follow slot duration. No order promo is accepted by admin checkout. If a customer is regular, outside their validity period, or the relevant account price is zero or unset, regular pricing applies. Public tariff responses omit Management price fields. Historic reports keep using recorded invoice amounts and exclude in-house fees from club payables as before.
