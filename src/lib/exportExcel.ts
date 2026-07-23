import * as XLSX from "xlsx";
import { format } from "date-fns";
import { type Scan, discoverResultKeys, resultValue, prettyKey } from "@/lib/vitals-data";

export function exportExcel(rows: Scan[], periodLabel: string, hidden?: Set<string>) {
  const keys = discoverResultKeys(rows).filter((k) => !hidden?.has(k));

  const dataRows = rows.map((r) => {
    const base: Record<string, unknown> = {
      "Screening Date": format(new Date(r.created_at), "dd-MMM-yyyy"),
      "Screening Time": format(new Date(r.created_at), "hh:mm a"),
      "Employee Code": r.employee_code ?? "",
      "Employee Name": r.employee_name ?? "",
      HQ: r.employee_hq ?? "",
      Region: r.employee_region ?? "",
      "Doctor Name": r.doctor_name ?? "",
      Speciality: r.doctor_speciality ?? "",
      "Doctor City": r.doctor_city ?? "",
      "Patient Age": r.age ?? "",
      Gender: r.sex ?? "",
      "Height (cm)": r.height_cm ?? "",
      "Weight (kg)": r.weight_kg ?? "",
      "Waist (in)": r.waist_in ?? "",
    };
    for (const k of keys) base[prettyKey(k)] = resultValue(r, k) ?? "";
    return base;
  });

  const doctors = new Set(rows.map((r) => r.doctor_code || r.doctor_name).filter(Boolean));
  const employees = new Set(rows.map((r) => r.employee_code).filter(Boolean));
  const summary = [
    { Metric: "Period", Value: periodLabel },
    { Metric: "Total Scans", Value: rows.length },
    { Metric: "Doctors Engaged", Value: doctors.size },
    { Metric: "Employees Active", Value: employees.size },
    { Metric: "Exported On", Value: format(new Date(), "dd-MMM-yyyy hh:mm a") },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dataRows), "Scans");
  XLSX.writeFile(wb, `AI_Vitals_Report_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
}
