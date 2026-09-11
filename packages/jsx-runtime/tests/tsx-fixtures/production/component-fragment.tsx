const Shell = (props: { title: string; depth: number }) => (
  <>
    <text variant="title">{props.title}</text>
    <column gap="md" padding={props.depth}>
      <text variant="body">inner</text>
    </column>
  </>
);

export const node = <Shell title="Contract" depth={8} />;
