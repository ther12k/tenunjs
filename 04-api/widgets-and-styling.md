---
okf_version: 0.2
title: "Widgets and Styling API"
summary: "Typed layout, themes, semantics, and widget composition."
type: reference
status: accepted
---

# Widgets and styling

```tsx
<Card
  padding="md"
  radius="lg"
  background="surfaceRaised"
  semantics={{ role: 'group', label: 'Order summary' }}
>
  <Row gap="sm" align="center">
    <Icon name="package" decorative />
    <Expanded>
      <Column gap="xs">
        <Text variant="title">Order #A-1042</Text>
        <Text tone="muted">Ready for pickup</Text>
      </Column>
    </Expanded>
    <Badge tone="success">Ready</Badge>
  </Row>
</Card>
```

## Typed theme

```ts
export const appTheme = defineTheme({
  colors: {
    surface: '#FFFFFF',
    surfaceRaised: '#F5F6F8',
    text: '#16181D',
    accent: '#356AE6',
    danger: '#B42318',
  },
  spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
  radius: { sm: 6, md: 10, lg: 16 },
  typography: {
    body: { size: 16, lineHeight: 22 },
    title: { size: 20, lineHeight: 26, weight: 600 },
  },
});
```

The public style API is typed and layout-oriented. It is not CSS, has no selectors or cascade, and compiles to host-widget property blocks.
