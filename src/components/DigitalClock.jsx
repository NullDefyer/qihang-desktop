// Compact tabular numerals remain readable in every console color mode.
export function DigitalClock({ value }) {
  return <span className="digital-clock" aria-label={value}>{value}</span>;
}
