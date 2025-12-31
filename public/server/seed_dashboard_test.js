
const http = require('http');

const API_BASE = 'http://localhost:3000/api';
let token = '';
let schoolId = '';

// Helper for requests
async function req(method, path, body = null, authToken = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    return new Promise((resolve, reject) => {
        const options = {
            method,
            headers,
        };

        const request = http.request(API_BASE + path, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json);
                    } else {
                        reject(new Error(json.error || `Status ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(new Error(`Invalid JSON: ${data}`));
                }
            });
        });

        request.on('error', reject);
        if (body) request.write(JSON.stringify(body));
        request.end();
    });
}

async function run() {
    try {
        console.log("1. Logging in as Admin...");
        const login = await req('POST', '/auth/login', { username: 'admin', password: 'admin123' });
        token = login.accessToken;
        console.log("   Success. Token obtained.");

        console.log("2. Creating/Finding a Test School...");
        const schools = await req('GET', '/data/schools', null, token);
        let school = schools.find(s => s.username === 'test_school_v2');

        if (!school) {
            const newSchool = await req('POST', '/data/schools', {
                name: 'Test School Verification',
                username: 'test_school_v2',
                password: 'password123'
            }, token);
            // Verify it was created
            const schoolsNow = await req('GET', '/data/schools', null, token);
            school = schoolsNow.find(s => s.username === 'test_school_v2');
            console.log("   Created new school.");
        } else {
            console.log("   Found existing test school.");
        }
        schoolId = school.id;

        console.log(`3. Creating Test Students for School #${schoolId}...`);

        // Student A: Boys Uniform
        const s1 = await req('POST', '/data/student', {
            school_id: schoolId,
            admission_no: 'TEST-001',
            roll_no: '101',
            name: 'John Doe (Verification)',
            class: '10',
            section: 'A',
            house: 'Red',
            gender: 'Male'
        }, token);
        const s1Id = s1.id || (await getStudentId('TEST-001'));

        // Student B: Girls Uniform
        const s2 = await req('POST', '/data/student', {
            school_id: schoolId,
            admission_no: 'TEST-002',
            roll_no: '102',
            name: 'Jane Smith (Verification)',
            class: '10',
            section: 'A',
            house: 'Blue',
            gender: 'Female'
        }, token);
        const s2Id = s2.id || (await getStudentId('TEST-002'));

        console.log("4. Adding Measurements with Item Quantities...");

        // Update Measurements for S1 (John)
        // He has 2 shirts and 1 pant
        await req('POST', '/data/measurements', {
            student_id: s1Id,
            data: { U1: 15, U2: 40, L1: 32 },
            remarks: "Test Remarks",
            is_absent: false,
            item_quantities: {
                "BOYS - UNIFORM T-SHIRT": 2,
                "BOYS - TRACK PANT": 1
            }
        }, token);

        // Update Measurements for S2 (Jane)
        // She has 1 skirt and 2 shirts
        await req('POST', '/data/measurements', {
            student_id: s2Id,
            data: { U1: 14, U2: 38, L5: 28 },
            remarks: "Test Remarks Jane",
            is_absent: false,
            item_quantities: {
                "GIRLS - UNIFORM T-SHIRT": 2,
                "GIRLS - SKIRT": 1
            }
        }, token);

        console.log("✅ Seed Data Created Successfully!");
        console.log("   You can now verify the dashboard.");

    } catch (e) {
        console.error("❌ Error during seeding:", e.message);
    }
}

async function getStudentId(admNo) {
    const students = await req('GET', `/data/students/${schoolId}`, null, token);
    const s = students.find(x => x.admission_no === admNo);
    return s ? s.id : null;
}

run();
