
// MEASUREMENTS EXPORT LOGIC
function downloadMeasurementsPDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape

    const schoolName = document.getElementById('td-school-name').innerText;
    const data = window.filteredDataForExport || globalStudents.filter(st => st.school_id == tdCurrentSchoolId);

    doc.setFontSize(18);
    doc.text(`${schoolName} - Full Measurements Matrix`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 28);

    // Columns including U1-U8 and L1-L8
    const head = [['Name', 'Class/Sec', 'Gender', 'Pattern',
        'U1', 'U2', 'U3', 'U4', 'U5', 'U6', 'U7', 'U8',
        'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8',
        'Items (Qty)']];

    const body = data.map(s => {
        const m = getMeasurementsSafe(s);
        const iq = getItemQuantitiesSafe(s);
        const qtyStr = Object.entries(iq).map(([k, v]) => `${v} ${k.replace(/BOYS - |GIRLS - /g, '')}`).join(', ');

        return [
            s.name,
            `${s.class || ''} ${s.section || ''}`,
            s.gender || '-',
            s.pattern_name || '-',
            m.u1 || '-', m.u2 || '-', m.u3 || '-', m.u4 || '-', m.u5 || '-', m.u6 || '-', m.u7 || '-', m.u8 || '-',
            m.l1 || '-', m.l2 || '-', m.l3 || '-', m.l4 || '-', m.l5 || '-', m.l6 || '-', m.l7 || '-', m.l8 || '-',
            qtyStr
        ];
    });

    doc.autoTable({
        head: head,
        body: body,
        startY: 35,
        theme: 'grid',
        styles: { fontSize: 7, cellPadding: 1 }, // Smaller font for wide table
        headStyles: { fillColor: [59, 130, 246] }
    });

    doc.save(`${schoolName}_Measurements_Matrix.pdf`);
}

function downloadMeasurementsExcel() {
    const schoolName = document.getElementById('td-school-name').innerText;
    const data = window.filteredDataForExport || globalStudents.filter(st => st.school_id == tdCurrentSchoolId);

    const exportData = data.map(s => {
        const m = getMeasurementsSafe(s);
        const iq = getItemQuantitiesSafe(s);
        const qtyStr = Object.entries(iq).map(([k, v]) => `${v} ${k.replace(/BOYS - |GIRLS - /g, '')}`).join(', ');

        return {
            "Name": s.name,
            "Roll No": s.roll_no,
            "Class": s.class,
            "Section": s.section,
            "Gender": s.gender,
            "Pattern": s.pattern_name,
            "U1": m.u1, "U2": m.u2, "U3": m.u3, "U4": m.u4, "U5": m.u5, "U6": m.u6, "U7": m.u7, "U8": m.u8,
            "L1": m.l1, "L2": m.l2, "L3": m.l3, "L4": m.l4, "L5": m.l5, "L6": m.l6, "L7": m.l7, "L8": m.l8,
            "Items": qtyStr,
            "Remarks": m.remarks
        };
    });

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Measurements");
    XLSX.writeFile(wb, `${schoolName}_Measurements_Matrix.xlsx`);
}
