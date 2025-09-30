const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
require("dotenv").config();
const fs = require("fs");

const app = express();

// ===== Middleware =====
app.use(cors());
app.use(bodyParser.json());

// Serve static frontend safely
const frontendPath = path.join(__dirname, ""); // make sure index.html is here
app.use(express.static(frontendPath));

// Catch-all route for frontend (React SPA)
// Only for routes that do NOT start with /api or /students or /login /register
app.get(/^\/(?!api|students|login|register).*/, (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

const SECRET_KEY = process.env.SECRET_KEY;
const MONGO_URI = process.env.MONGO_URI;

// ===== MongoDB Connection =====
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ===== Schemas =====
const vendorSchema = new mongoose.Schema({
  vendorname: String,
  restaurant: String,
  email: { type: String, unique: true },
  password: String
});

const Vendor = mongoose.model("Vendor", vendorSchema);

const studentSchema = new mongoose.Schema({
  name: String,
  phone: String,
  meals: String,
  totalAmount: Number,
  paidAmount: Number,
  pendingAmount: Number,
  startDate: Date,
  endDate: Date,
  nextPaymentDate: Date,
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: "Vendor" },
});
const Student = mongoose.model("Student", studentSchema);

// ===== JWT Middleware =====
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).send("No token provided");

  const token = authHeader.split(" ")[1];
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).send("Invalid token");
    req.user = user;
    next();
  });
}

// ===== Vendor Routes =====
// Register Vendor
app.post("/register", async (req, res) => {
  try {
    const { vendorname, restaurant, email, password } = req.body;

    // Check if vendor already exists
    const existing = await Vendor.findOne({ email });
    if (existing) return res.status(400).json({ msg: "Email already registered" });

    const newVendor = new Vendor({ vendorname, restaurant, email, password });
    await newVendor.save();

    res.json({ msg: "✅ Vendor registered successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "❌ Server error" });
  }
});

// Login Vendor
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).send("Email and password required");

    const vendor = await Vendor.findOne({ email });
    if (!vendor) return res.status(401).send("Invalid credentials");

    const isPasswordValid = await bcrypt.compare(password, vendor.password);
    if (!isPasswordValid) return res.status(401).send("Invalid credentials");

    // Create JWT
    const token = jwt.sign(
      { id: vendor._id, email: vendor.email, vendorname: vendor.vendorname },
      SECRET_KEY,
      { expiresIn: "4d" }
    );

    // ===== Save login details to JSON file without duplicates =====
    const loginFilePath = path.join(__dirname, "logins.json");
    let logins = [];

    if (fs.existsSync(loginFilePath)) {
      const data = fs.readFileSync(loginFilePath, "utf8");
      if (data) logins = JSON.parse(data);
    }

    // Check if the user is already logged in
    const existingIndex = logins.findIndex(l => l.email === vendor.email);
    const newLogin = {
      id: vendor._id,
      name: vendor.vendorname,
      email: vendor.email,
      time: new Date().toISOString(),
    };

    if (existingIndex >= 0) {
      // Update the time instead of adding a new entry
      logins[existingIndex].time = newLogin.time;
    } else {
      // Add new login
      logins.push(newLogin);
    }

    fs.writeFileSync(loginFilePath, JSON.stringify(logins, null, 2));

    res.status(200).json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).send("Login failed");
  }
});





// Update Vendor
// ===== Update Vendor Profile =====
app.put("/vendor", authenticateToken, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Find the vendor
    const vendor = await Vendor.findById(req.user.id);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });

    // Update fields if provided
    if (name) vendor.vendorname = name;
    if (email) vendor.email = email;
    if (password) vendor.password = await bcrypt.hash(password, 10);

    await vendor.save();
    res.status(200).json({ message: "Profile updated successfully", vendor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error updating profile" });
  }
});


// ===== Student Routes =====
// Add Student
// Add Student (matches frontend /studentsadd)
app.post("/studentsadd", authenticateToken, async (req, res) => {
  try {
    const {
      name,
      phone,
      meals,
      startDate,
      endDate,
      totalAmount,
      paidAmount,
    } = req.body;

    // Validate all required fields
    if (
      !name ||
      !phone ||
      !meals ||
      !startDate ||
      !endDate ||
      totalAmount == null ||
      paidAmount == null
    ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const pendingAmount = totalAmount - paidAmount;

    const newStudent = new Student({
      name,
      phone,
      meals,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      totalAmount,
      paidAmount,
      pendingAmount,
      vendorId: req.user.id,
    });

    // Set next payment date 1 month after endDate
    const nextPayment = new Date(endDate);
    nextPayment.setMonth(nextPayment.getMonth() + 1);
    newStudent.nextPaymentDate = nextPayment;

    await newStudent.save();

    // Return JSON response
    res.status(201).json({ message: "Student added successfully", student: newStudent });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error adding student" });
  }
});


// Fetch Students for logged-in Vendor
app.get("/students", authenticateToken, async (req, res) => {
  try {
    const students = await Student.find({ vendorId: req.user.id });
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error fetching students");
  }
});

// Delete Student

// ===== Delete Student =====
app.delete("/students/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Find and delete student only for the logged-in vendor
    const student = await Student.findOneAndDelete({ _id: id, vendorId: req.user.id });

    if (!student) return res.status(404).json({ message: "Student not found" });

    res.json({ message: "✅ Student deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error deleting student" });
  }
});


// ===== Update Student (Edit / Next Month) =====
app.put("/students/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    // Find the student for this vendor
    const student = await Student.findOne({ _id: id, vendorId: req.user.id });
    if (!student) return res.status(404).json({ message: "Student not found" });

    // Update allowed fields
    const allowedFields = [
      "name", "phone", "meals", "startDate", "endDate",
      "totalAmount", "paidAmount", "pendingAmount"
    ];

    allowedFields.forEach((field) => {
      if (updates[field] !== undefined) {
        // Convert date strings to Date objects
        if (field === "startDate" || field === "endDate") {
          student[field] = new Date(updates[field]);
        } else {
          student[field] = updates[field];
        }
      }
    });

    // If endDate changed, update nextPaymentDate
    if (updates.endDate) {
      const nextPayment = new Date(updates.endDate);
      nextPayment.setMonth(nextPayment.getMonth() + 1);
      student.nextPaymentDate = nextPayment;
    }

    await student.save();
    res.status(200).json({ message: "Student updated successfully", student });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error updating student" });
  }
});


// ===== Start Server =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`)
);
 
