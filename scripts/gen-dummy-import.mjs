// Generates a dummy headcount Excel file for the Onboarding Hub import screen.
// All names, emails and IDs are fictional — no real employee data.
import ExcelJS from "exceljs";

const firstNames = ["Alex", "Taylor", "Jordan", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Rowan", "Quinn", "Skyler", "Dana", "Reese", "Harper", "Emerson", "Finley"];
const lastNames = ["Novak", "Keller", "Brandt", "Sorin", "Vance", "Holt", "Marsh", "Doyle", "Fenwick", "Carr", "Lindgren", "Brodsky", "Tanaka", "Weaver", "Olsen", "Park"];
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

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Headcount Demo");

const headers = [
  "Employee ID", "Full name", "Preferred full name", "First name", "Last name", "Email", "Gender",
  "Status", "Employment type", "Rotation", "Rotation date", "Business unit", "Department", "Leapsome Team",
  "Job title", "Manager", "Location", "Country", "Legal entity", "Start date", "End date",
  "Probation end", "Offboarding reason", "Leapsome ID", "Timebase ID",
];
ws.addRow(headers);
ws.getRow(1).font = { bold: true };

const N = 40;
let n = 0;
for (let i = 0; i < N; i++) {
  const fn = firstNames[i % firstNames.length];
  const ln = lastNames[(i * 5) % lastNames.length];
  const [city, country] = places[i % places.length];
  const start = new Date(Date.UTC(2021 + (i % 4), (i * 3) % 12, 1 + (i % 27)));
  const leaver = i % 13 === 0;
  const end = leaver ? new Date(Date.UTC(2026, (i % 10), 10)) : null;
  const probation = new Date(start.getTime() + 90 * 864e5);
  const manager = `${firstNames[(i + 4) % firstNames.length]} ${lastNames[(i + 2) % lastNames.length]}`;
  const email = `${fn}.${ln}${i}`.toLowerCase() + `@${DOMAIN}`;

  ws.addRow([
    `D-${String(++n).padStart(4, "0")}`,
    `${fn} ${ln}`,
    i % 6 === 0 ? `${fn} "${fn.slice(0, 3)}" ${ln}` : null, // preferred full name, only set sometimes
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
    start,
    end,
    probation,
    leaver ? "Resigned" : null,
    `lps-demo-${1000 + i}`,
    `tb-demo-${2000 + i}`,
  ]);
}

ws.columns.forEach((col) => { col.width = 18; });
[11, 20, 21, 22].forEach((c) => { ws.getColumn(c).numFmt = "dd.mm.yyyy"; });

await wb.xlsx.writeFile(process.argv[2] || "leapsome-dummy-import.xlsx");
console.log("done");
