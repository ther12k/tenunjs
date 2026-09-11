const Greet = (props: { name: string }) => (
  <text variant="body">Hello, {props.name}!</text>
);

export const node = <Greet name="Tenun" />;
