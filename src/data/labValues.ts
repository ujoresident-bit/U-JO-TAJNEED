// Lab reference values shown in the exam screen's slide-over.
// IMPORTANT: these entries are a SAMPLE used to lay out the panel.
// Replace them with values from the reference source approved by the admin
// and set LAB_VALUES_ARE_SAMPLE to false (this hides the "Sample" notice).
export const LAB_VALUES_ARE_SAMPLE = true;

export interface LabRow { name: string; range: string; unit: string }
export interface LabGroup { title: string; rows: LabRow[] }

export const LAB_GROUPS: LabGroup[] = [
  { title: 'Serum chemistry', rows: [
    { name: 'Sodium', range: '135 – 145', unit: 'mEq/L' },
    { name: 'Potassium', range: '3.5 – 5.0', unit: 'mEq/L' },
    { name: 'Chloride', range: '95 – 105', unit: 'mEq/L' },
    { name: 'Bicarbonate', range: '22 – 28', unit: 'mEq/L' },
    { name: 'Creatinine', range: '0.6 – 1.2', unit: 'mg/dL' },
    { name: 'Glucose, fasting', range: '70 – 100', unit: 'mg/dL' }
  ] },
  { title: 'Hematology', rows: [
    { name: 'Hemoglobin, male', range: '13.5 – 17.5', unit: 'g/dL' },
    { name: 'Hemoglobin, female', range: '12.0 – 16.0', unit: 'g/dL' },
    { name: 'Leukocytes', range: '4,500 – 11,000', unit: '/µL' },
    { name: 'Platelets', range: '150,000 – 400,000', unit: '/µL' }
  ] },
  { title: 'Arterial blood gas', rows: [
    { name: 'pH', range: '7.35 – 7.45', unit: '' },
    { name: 'PaCO₂', range: '33 – 45', unit: 'mm Hg' },
    { name: 'PaO₂', range: '75 – 105', unit: 'mm Hg' }
  ] }
];
