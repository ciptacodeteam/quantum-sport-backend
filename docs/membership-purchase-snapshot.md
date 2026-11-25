# Value Pack purchase terms

Each online or cashier purchase stores purchasedPrice, purchasedSessions,
purchasedDuration and purchasedType on MembershipUser. Owned-package APIs,
booking eligibility, activation, cancellation and tracking read those terms.
Catalogue edits only affect later purchases. Remaining balances are never reset.

Cash revenue continues to use paid invoice amounts, excluding processing fees.
Court performance allocates (paid invoice total - processingFee) / purchasedSessions
per playing hour. It never uses the current catalogue quota or price. If a historic
quota is unknown, those hours appear in unvaluedMembershipHours and contribute no
estimated revenue until corrected.

## Rollout

1. Pause package checkout and catalogue editing for this rollout. Run prisma/membership-purchase-snapshot.sql against the intended database
   before deploying this application version. The SQL is additive and repeatable.
   Run its final SELECT in a SQL client to inspect unresolved purchases; Prisma
   db execute does not display query results.
2. Price is recovered from the original invoice subtotal, including zero-price
   purchases. Other terms are backfilled only when the master has not been edited
   since the purchase. An updatedAt change is conservatively treated as unknown,
   even if it only changed descriptive text.
3. Reconcile every unresolved purchase against original purchase records or an
   audited backup and fill the four purchased fields by purchase ID. Do not infer
   original quota from remaining balance, or replace unknown terms with the
   edited master. An invoice alone does not prove original quota or hour type.
4. Verify no unresolved rows remain before enabling the new application. Its
   owned-package operations reject unverified terms rather than silently applying
   the latest master; catalogue edits are also blocked until affected historical
   purchases have been reconciled. Paid invoice cash revenue remains available.
5. Generate Prisma Client, deploy, and resume checkout. All new purchases capture their own terms.

SQL was checked against an isolated PostgreSQL instance for known originals,
unknown historical terms, zero-price invoices and repeat execution after a master
change. The application database was not changed during implementation.

## Confirmed legacy repair (2026-11-25)

The owner confirmed that existing catalogue price, sessions, duration and hour
type have never changed. Before editing those terms, run
`bun run db:membership-confirmed-legacy-snapshot` against the intended database,
after the standard snapshot SQL above. This one-time SQL fills only missing
snapshot fields on purchases made through 2026-11-25 WIB. Existing snapshots,
remaining balances, expiry dates and payments are preserved. Invoice subtotal
takes priority over catalogue price, including complimentary purchases.

This repair is intentionally excluded from recurring Docker startup. Do not
reuse it after changing catalogue terms. Run its final SELECT in a SQL client
to verify `unresolved_purchases = 0`; Prisma db execute does not print the result.
