import pandas as pd

file_path = "C:/Users/sajus/.gemini/antigravity/scratch/planetsolutions/excel-editor-dashboard/public/not_working_file.xlsx"

try:
    # Read the file without header first to inspect raw rows
    df = pd.read_excel(file_path, header=None)
    
    print("--- First 20 Rows ---")
    print(df.head(20).to_string())
    
    print("\n\n--- Searching for 'Admission No' ---")
    # Find matching cells
    for r_idx, row in df.iterrows():
        for c_idx, val in enumerate(row):
            if str(val).strip() == "Admission No":
                print(f"FOUND EXACT MATCH at Row {r_idx}, Col {c_idx}")
            elif "Admission No" in str(val):
                print(f"FOUND PARTIAL MATCH at Row {r_idx}, Col {c_idx}: '{val}'")

except Exception as e:
    print(f"Error reading file: {e}")
