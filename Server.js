const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bodyParser = require("body-parser");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
require("dotenv").config();

const app = express();

// ===== Middleware =====
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // handle form submissions

// ===== Serve Frontend (optional) =====
const frontendPath = path.join(__dirname, ""); 
app.use(express.static(frontendPath));

app.get(/^\/(?!api|students|login|register).*/, (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

// ===== ENV Vars =====
const SECRET_KEY = process.env.SECRET_KEY || "mysecretkey";
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/demo";

// ===== MongoDB Connection =====
mongoose
  .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ===== Schemas =====
// Vendor Schema
const vendorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
});
const Vendor = mongoose.model("Vendor", vendorSchema);

// Student Schema
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
  if (!authHeader) return res.status(401).json({ message: "No token provided" });

  const token = authHeader.split(" ")[1];
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = user; // { id, email }
    next();
  });
}

// ===== Vendor Routes =====

// Register Vendor
app.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existing = await Vendor.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: "Vendor already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newVendor = new Vendor({ name, email, password: hashedPassword });
    await newVendor.save();

    res.json({ message: "Vendor registered successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Login Vendor
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const vendor = await Vendor.findOne({ email });
    if (!vendor) return res.status(401).json({ error: "Invalid credentials" });

    const isPasswordValid = await bcrypt.compare(password, vendor.password);
    if (!isPasswordValid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign({ id: vendor._id, email: vendor.email }, SECRET_KEY, { expiresIn: "4d" });
    res.json({ message: "Login successful", token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed" });
  }
});



// Update Vendor Profile
app.put("/vendor", authenticateToken, async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Find vendor by ID from JWT
    const vendor = await Vendor.findById(req.user.id);
    if (!vendor) return res.status(404).json({ error: "Vendor not found" });

    // Update fields if provided
    if (name) vendor.name = name;
    if (email) vendor.email = email;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      vendor.password = hashedPassword;
    }

    await vendor.save();
    res.json({ message: "Profile updated successfully", vendor });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error updating profile" });
  }
});


// ===== Student Routes =====

// Add Student
app.post("/students", authenticateToken, async (req, res) => {
  try {
    const { name, phone, meals, startDate, endDate, totalAmount, paidAmount } = req.body;

    if (!name || !phone || !meals || !startDate || !endDate || totalAmount == null || paidAmount == null) {
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

    await newStudent.save();
    res.json({ message: "Student added successfully", student: newStudent });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error adding student" });
  }
});

// Get Students (Vendor-specific)
app.get("/students", authenticateToken, async (req, res) => {
  try {
    const students = await Student.find({ vendorId: req.user.id });
    res.json(students);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching students" });
  }
});

// Update Student
app.put("/students/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, meals, totalAmount, paidAmount, startDate, endDate } = req.body;

    const student = await Student.findOne({ _id: id, vendorId: req.user.id });
    if (!student) return res.status(404).json({ message: "Student not found" });

    if (name) student.name = name;
    if (phone) student.phone = phone;
    if (meals) student.meals = meals;
    if (totalAmount != null) student.totalAmount = totalAmount;
    if (paidAmount != null) student.paidAmount = paidAmount;

    if (startDate) student.startDate = new Date(startDate);
    if (endDate) student.endDate = new Date(endDate);

    if (totalAmount != null && paidAmount != null) {
      student.pendingAmount = totalAmount - paidAmount;
    }

    if (student.endDate) {
      const nextPayment = new Date(student.endDate);
      nextPayment.setMonth(nextPayment.getMonth() + 1);
      student.nextPaymentDate = nextPayment;
    }

    await student.save();
    res.json({ message: "Student updated successfully", student });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error updating student" });
  }
});

// Delete Student
app.delete("/students/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await Student.findOneAndDelete({ _id: id, vendorId: req.user.id });
    if (!deleted) return res.status(404).json({ message: "Student not found" });

    res.json({ message: "Student deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Error deleting student" });
  }
});

// ===== Start Server =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
