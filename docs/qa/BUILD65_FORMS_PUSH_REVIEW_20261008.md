# Restore the TestFlight 65 forms

Restore the event creator, sales offer editor and two-step customer checkout appearance from build 65. Keep the current product-specific discount validation and integer-cent payment totals. The same coupon field is available for complete VIP tables. Organizers retain all-ticket, all-table, combined and selected-product coupon scopes.

The presentation adapter reuses the current discount controller, including invalidation when changing product and protection against late validation responses. Payment handlers remain in the event screen.

Validation: TypeScript passed; app suite 267 passed/1 skipped, followed by all 6 discount-controller tests including two new presentation-adapter regressions. Lint completed with 3 existing warnings.

Screenshots under build65-restored are mobile-width React Native Web renderings of the actual components with sample data and payments disabled. They are not native device screenshots.
