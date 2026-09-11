export const orderA = (
  <>
    <text key="a" variant="body">A</text>
    <text key="b" variant="body">B</text>
  </>
);

export const orderB = (
  <>
    <text key="b" variant="body">B</text>
    <text key="a" variant="body">A</text>
  </>
);

export const numericKey = <text key={1} variant="body">one</text>;
export const stringKey = <text key="1" variant="body">one-s</text>;
export const zeroKey = <text key={0} variant="body">zero</text>;
