# Management customers

Management is a customer category, not a staff role. Only ADMIN and SUPER_ADMIN may create a Management customer or change its classification, start date and account prices. CASHIER may book for an eligible customer but cannot grant Management privileges or edit tariff settings. The generic customer edit API only writes the existing contact fields.

## Deployment

Apply the additive SQL before deploying the new backend (its Prisma user queries read the new fields):

```sh
bun run db:management-customers
bun run db:generate
```

The SQL is idempotent and leaves existing customers regular; all seven account prices default to zero (normal pricing). The Docker entrypoint applies this script automatically. Existing global Management tariff values are retained only for compatibility and are no longer used; configure each Management account explicitly. No existing invoices or packages are repriced.

## Admin workflow

1. In Kelola Kustomer, choose **Buat pelanggan Management**, or open an existing customer and enable **Kategori Management**. The optional start date is inclusive, based on the playing date in WIB. There is no end date; legacy end dates no longer disable Management rates and are cleared when saving this form. Existing phone numbers cannot create another account.
2. In **Kelola Kustomer → Detail Akun → Pengaturan Management**, enable the Management label and configure two independent sections. **Coaching In-house** has **Lapangan coaching per jam**, **Coach In-house per jam** and **Peserta tambahan per orang/jam**, used only by direct in-house sessions on any court. **Booking lapangan biasa** has four hourly prices: Padel Happy Hour, Padel Peak Hour, Tennis Happy Hour and Tennis Peak Hour. Happy/Peak hours, effective dates and full Happy Hour weekdays follow the branch/sport tariff rules. Prices apply to all courts of the selected sport, from the account's optional start date. Each component is independent: **Rp0 means use normal pricing, never free**. A positive value replaces that component's normal hourly price. The old Management section has been removed from Pengaturan Jam & Tarif.
3. Book a court from the dashboard and select that customer. Ordinary court booking uses the matching sport/Happy/Peak price. Direct in-house coaching uses the account Management coach tariff when positive. **Tarif Management** appears on each eligible court session. Extra in-house participants use the account’s positive **Peserta tambahan per orang/jam** rate from the second person; zero or unset uses the normal rate (Rp100,000/person/hour). Prepaid wallets keep their purchased extra-participant terms.
4. Checkout reads classification from the database and loads the saved account prices from the database; any zero component uses normal effective branch/sport pricing. It rejects stale `expectedTotal` quotes. Invoice, court detail and coach line store the final charged amounts; coach description records Management.

The rate does not apply to public website checkout, club coach fees, court membership usage, recurring Value Pack reservations, or prepaid in-house wallet redemption. With a club coach, the court uses the matching ordinary Management sport/Happy/Peak tariff without another court bundle discount; coach fees are unchanged. Court charges follow slot duration. No order promo is accepted by admin checkout. If a customer is regular, before their start date, or the relevant account price is zero or unset, regular pricing applies. Public tariff responses omit Management price fields. Historic reports keep using recorded invoice amounts and exclude in-house fees from club payables as before.

The legacy `managementCourtHourlyPrice` and `managementCoachHourlyPrice` account columns now apply only to direct in-house coaching. The four new ordinary-court prices do not inherit coaching prices. A slot uses the tariff band that fully contains its playing interval; intervals outside the configured bands retain normal pricing. Existing saved booking and invoice amounts remain unchanged.
