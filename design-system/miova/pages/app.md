# Flutter App override

This shopping client extends the actual cobalt/ink MIOVA storefront, not the earlier generated luxury-brand landing-page pattern. Product discovery and checkout take priority over brand storytelling.

- Material 3 controls, semantic theme colors; cobalt seed `#3847e7`, light/dark paired.
- Search, categories and product cards; no platform capability marketing on the customer home.
- 48dp controls, safe areas, four primary destinations, navigation rail on wider layouts.
- 16px body text, visible field labels, keyboard/autofill types, 200% text accommodation.
- Use system font fallbacks for Chinese; no remote font dependency for launch.
- Minimal native motion, honor reduced-motion setting; errors preserve input and offer retry.
- Pending order explicitly does not mean payment or dispatch.
