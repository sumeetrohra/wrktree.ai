# Design system (apps/mobile)

The component library is [React Native Reusables](https://reactnativereusables.com): shadcn/ui
for React Native, styled with NativeWind and the same theme tokens.

| Id | Rule | Enforced by |
|---|---|---|
| U1 | Use the components in `@/shared/components/ui` (added with the RN Reusables CLI). Don't hand-build buttons, inputs, dialogs, cards, badges, tabs, etc. | `lint:no-restricted-imports` (L10), `review` |
| U2 | Generated components are not edited by hand except to apply theme changes, and are excluded from lint. Re-add with the CLI to update. | `review` |
| U3 | Use component variants (`variant`, `size`) rather than overriding their styles. | `review` |
| U4 | Colours come only from semantic tokens (`bg-background`, `text-foreground`, `border-destructive`). No hex, `rgb()`, or raw Tailwind palette classes (`text-red-500`). | `lint:no-restricted-syntax` |
| U5 | Icons come from `lucide-react-native` only. No emoji or inline SVG as icons. | `review` |
| U6 | Compose screens from design-system primitives; layout uses `View` with NativeWind classes. | `review` |
