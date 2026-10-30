/** Generates samples/sample-headcount.xlsx — a deliberately messy file shaped like the real headcount file. */
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const first = ["Anna", "Mariam", "Illia", "Paulius", "Iryna", "Filip", "Yuliia", "Aram", "Lilit", "Davit", "Olena", "Tomas", "Ana", "Marko", "Sona", "Gor"];
const last = ["Baharyan", "Chtchyan", "Ivanov", "Pelys", "Kuzmenko", "Janevski", "Lyvch", "Petrosyan", "Hakobyan", "Grigoryan", "Shevchenko", "Kazlauskas", "Popescu", "Nikolov", "Sargsyan", "Avetisyan"];
const bus = ["Engineering", "Finance", "People", "Sales", "Operations", "Legal"];
const places: [string, string][] = [["Yerevan", "Armenia"], ["Kyiv", "Ukraine"], ["Vilnius", "Lithuania"], ["Skopje", "North Macedonia"], ["Warsaw", "Poland"]];
const rot = ["None", "2/2", "Rotational", "Remote"];

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Headcount 2025");
ws.addRow(["Company headcount — CONFIDENTIAL"]);
ws.addRow([]);
const months: Date[] = [];
for (let i = 0; i < 12; i++) months.push(new Date(Date.UTC(2025, i, 0))); // 31.12.2024 → 30.11.2025
ws.addRow(["Emp ID", "Name Surname", "E-mail", "Sex", "Status", "Business Unit", "Position", "Line manager", "Office", "Country", "Rotation", "Hire date", "Last working day", "Cost center", ...months]);

let n = 0;
for (let i = 0; i < 240; i++) {
  const fn = first[i % first.length], ln = last[(i * 7) % last.length];
  const [city, country] = places[i % places.length];
  const start = new Date(Date.UTC(2019 + (i % 7), (i * 5) % 12, 1 + (i % 27)));
  const leaver = i % 11 === 0;
  const end = leaver ? new Date(Date.UTC(2025, (i % 10), 15)) : null;
  const startFmt = i % 3 === 0 ? start : i % 3 === 1 ? `${String(start.getUTCDate()).padStart(2, "0")}.${String(start.getUTCMonth() + 1).padStart(2, "0")}.${start.getUTCFullYear()}` : start.toISOString().slice(0, 10);
  const monthly = months.map((m) => (m >= start && (!end || m <= new Date(end.getTime() + 31 * 864e5)) ? 1 : 0));
  ws.addRow([
    `E-${String(++n).padStart(4, "0")}`, `${fn} ${ln}`, i % 37 === 5 ? "" : `${fn}.${ln}${i}@company.com`.toLowerCase(),
    i % 2 ? "F" : "M", leaver ? "Terminated" : i % 17 === 0 ? "Maternity leave" : "Active",
    i % 29 === 3 ? "" : bus[i % bus.length], ["Engineer", "Analyst", "Manager", "Specialist"][i % 4], `${first[(i + 3) % 16]} ${last[(i + 5) % 16]}`,
    city, country, rot[i % rot.length], startFmt, end, `CC-${100 + (i % 9)}`, ...monthly,
  ]);
}
// edge cases: duplicate row, bad date, bad email, missing name
ws.addRow(["E-0002", "Mariam Chtchyan", "mariam.chtchyan1@company.com", "F", "Active", "Finance", "Analyst", "", "Kyiv", "Ukraine", "", "31/02/2023", null, "CC-101"]);
ws.addRow(["E-9999", "", "nobody@company.com", "", "Active"]);
ws.addRow(["E-9998", "Future Joiner", "not-an-email", "M", "", "Engineering", "Engineer", "Illia Ivanov", "Yerevan", "Armenia", "None", "2027-01-11", null]);
ws.getRow(3).font = { bold: true };
mkdirSync("samples", { recursive: true });
wb.xlsx.writeFile("samples/sample-headcount.xlsx").then(() => console.log("Wrote samples/sample-headcount.xlsx"));
