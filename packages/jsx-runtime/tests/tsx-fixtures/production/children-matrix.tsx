export const node = (
  <column>
    {"plain"}
    {123}
    {null}
    {undefined}
    {true}
    {false}
    {["a", ["b", ["c"]]]}
    {false && <text>never</text>}
    {true && <text variant="body">conditional</text>}
    <>
      <text>in-frag</text>
    </>
  </column>
);
