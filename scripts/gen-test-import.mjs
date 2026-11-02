// Generates a dummy test Excel file exercising every employee field, including the
// platform-expansion additions (career track, compliance checklist, onboarding
// deliverables, offboarding reason category). All names/emails are fictional.
import ExcelJS from "exceljs";

const firstNames = ["Alex", "Taylor", "Jordan", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Rowan", "Quinn", "Skyler", "Dana", "Reese", "Harper", "Emerson", "Finley", "Noor", "Kai", "Simone", "Theo"];
const lastNames = ["Novak", "Keller", "Brandt", "Sorin", "Vance", "Holt", "Marsh", "Doyle", "Fenwick", "Carr", "Lindgren", "Brodsky", "Tanaka", "Weaver", "Olsen", "Park", "Abadi", "Lund", "Ferraro", "Bishop"];
const businessUnits = ["Engineering", "Finance", "People", "Sales", "Operations", "Legal"];
const departments = ["Platform", "Payroll", "Talent Acquisition", "Enterprise Sales", "Logistics", "Compliance", "Product", "Customer Success"];
const teams = ["Core Services", "Payments", "Reporting", "Growth", "Infrastructure", "Onboarding Squad", "Data"];
const jobTitles = ["Engineer", "Senior Engineer", "Analyst", "Manager", "Specialist", "Coordinator", "Partner", "Consultant"];
const places = [["Yerevan", "Armenia"], ["Kyiv", "Ukraine"], ["Vilnius", "Lithuania"], ["Skopje", "North Macedonia"], ["Warsaw", "Poland"], ["Tbilisi", "Georgia"]];
const rotations = ["None", "2/2", "Rotational", "Remote"];
const employmentTypes = ["Full-time", "Part-time", "Contractor"];
const legalEntities = ["Demo Holding Ltd", "Demo Ops LLC", "Demo EU GmbH"];
const genders = ["Male", "Female"];
const DOMAIN = "demo-company.test";

// Deliberately messy/mixed-format values to exercise the parsers used on import.
const careerTrackValues = ["Specialist", "Junior", "Partner track", "partner/ap", "Flexible Specialist", "guest", "Field", "senior affiliated staff", "expert partner", "external pp"];
const boolValues = ["Yes", "No", "TRUE", "FALSE", "1", "0", "x", "", "Done", "Pending"]; // "Pending" won't parse -> warning + left blank
const offboardingCategoryValues = ["Resignation", "Redundancy", "mutual agreement", "end of fixed-term contract", "retirement", "dismissal - conduct", "something unusual"]; // last one -> falls back to "other"

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Test Import");

const headers = [
  "Employee ID", "Full name", "Preferred full name", "First name", "Last name", "Email", "Gender",
  "Status", "Employment type", "Rotation", "Rotation date", "Business unit", "Department", "Leapsome Team",
  "Job title", "Manager", "Location", "Country", "Legal entity", "Career track",
  "Contract in Timebase", "NDA signed", "GDPR consent", "CV on file", "Welcome kit sent",
  "Welcome training done", "E-learning completed", "2-week check-in done", "HRBP notified",
  "Start date", "End date", "Probation end", "Offboarding reason", "Offboarding reason category",
  "Leapsome ID", "Timebase ID",
];
ws.addRow(headers);
ws.getRow(1).font = { bold: true };

const N = 30;
let n = 0;
for (let i = 0; i < N; i++) {
  const fn = firstNames[i % firstNames.length];
  const ln = lastNames[(i * 5) % lastNames.length];
  const [city, country] = places[i % places.length];
  const start = new Date(Date.UTC(2021 + (i % 4), (i * 3) % 12, 1 + (i % 27)));
  const leaver = i % 9 === 0;
  const end = leaver ? new Date(Date.UTC(2026, (i % 10), 10)) : null;
  const probation = new Date(start.getTime() + 90 * 864e5);
  const manager = `${firstNames[(i + 4) % firstNames.length]} ${lastNames[(i + 2) % lastNames.length]}`;
  const email = `${fn}.${ln}${i}`.toLowerCase() + `@${DOMAIN}`;
  const b = (k) => boolValues[(i + k) % boolValues.length];

  ws.addRow([
    `D-${String(++n).padStart(4, "0")}`,
    `${fn} ${ln}`,
    i % 6 === 0 ? `${fn.slice(0, 3)} ${ln}` : null,
    fn,
    ln,
    email,
    genders[i % 2],
    leaver ? "Offboarded" : i % 11 === 0 ? "On leave" : i % 17 === 0 ? "Onboarding" : "Active",
    employmentTypes[i % employmentTypes.length],
    rotations[i % rotations.length],
    i % 4 === 0 ? start : null,
    businessUnits[i % businessUnits.length],
    departments[i % departments.length],
    teams[i % teams.length],
    jobTitles[i % jobTitles.length],
    manager,
    city,
    country,
    legalEntities[i % legalEntities.length],
    careerTrackValues[i % careerTrackValues.length],
    b(0), b(1), b(2), b(3), b(4),
    b(5), b(6), b(7), b(8),
    start,
    end,
    probation,
    leaver ? "Did not work out, left on own terms" : null,
    leaver ? offboardingCategoryValues[i % offboardingCategoryValues.length] : null,
    `lps-demo-${1000 + i}`,
    `tb-demo-${2000 + i}`,
  ]);
}

ws.columns.forEach((col) => { col.width = 16; });
[11, 30, 31, 32].forEach((c) => { ws.getColumn(c).numFmt = "dd.mm.yyyy"; });

const out = process.argv[2] || "test-import.xlsx";
await wb.xlsx.writeFile(out);
console.log("done:", out);
