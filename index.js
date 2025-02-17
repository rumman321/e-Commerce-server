require("dotenv").config();
const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const morgan = require("morgan");

const port = process.env.PORT || 9000;
const app = express();
// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());
app.use(morgan("dev"));

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;

  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

// const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.mq0mae1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ccgkb.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    //create collection
    const db = client.db("PlantNet");
    const userCollection = db.collection("users");
    const plantCollection = db.collection("plants");
    const orderCollection = db.collection("orders");

    //verify admin middleware
    const verifyAdmin = async (req,res,next) => {
      // console.log('data form verify admin middleware', req?.user);
      const email = req.user?.email
      const query = {email}
      const result = await userCollection.findOne(query)
      if(!result || result?.role !== 'admin'){
        return res.status(403).send({message:'Forbidden access. Admin Only'})
      }
      next()
    }
    //save or update
    app.post("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = req.body;
      //check user exit in db
      const isExist = await userCollection.findOne(query);
      if (isExist) {
        return res.send(isExist);
      }
      const result = await userCollection.insertOne({...user,timeStamp: Date.now(),role: 'customer'})
      res.send(result);
    });

    //manage user status
    app.patch("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = {email }
    
      const user = await userCollection.findOne(query)
      if(!user || user?.status == "Requested"){
        return res.status(404)
        .send({message: "You have already requested"})
      }

    
      const updateDoc ={
        $set:{
          status:"Requested"
        }
      }
      const result = await userCollection.updateOne(query,updateDoc)
      console.log(result);
      res.send(result)
    })
    //get all users data
    app.get("/all-users/:email", verifyToken, verifyAdmin, async(req,res)=>{
      const email = req.params.email
      const query = {email : {$ne:email}} //$ne :not equal db theke ai email chara baki email niye asa
      const result = await userCollection.find(query).toArray()
      res.send(result)
    })
    //update user role
    app.patch('/user/role/:email',verifyToken, async(req,res)=>{
      const email = req.params.email
      const {role} = req.body
      const filter = {email}
      const updateDoc = {
        $set:{role,status:'Verified'}
      }
      const result = await userCollection.updateOne(filter,updateDoc)
      res.send(result)
    })

    //get user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await userCollection.findOne(query);
      res.send({ role: result?.role });
    });
  
    // Generate jwt token
    app.post("/jwt", async (req, res) => {
      const email = req.body;
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
      } catch (err) {
        res.status(500).send(err);
      }
    });
    //save plants data db
    app.post("/plants", verifyToken, async(req,res)=>{
      const plant= req.body
      const result= await plantCollection.insertOne(plant)
      res.send(result)
    })
    //get plants data db
    app.get("/plants", async(req,res)=>{     
      const result= await plantCollection.find().toArray()
      res.send(result)
    })
    //get plants data db
    app.get("/plants/:id", async(req,res)=>{
      const id =req.params.id
      const query = {_id: new ObjectId(id)}
      const result = await plantCollection.findOne(query)
      res.send(result)
    })
    //save order data db
    app.post("/order", verifyToken, async(req,res)=>{
      const orderInfo= req.body
      const result= await orderCollection.insertOne(orderInfo)
      res.send(result)
    })
    //manage orders data db
    app.patch("/plants/quantity/:id",verifyToken, async(req,res)=>{
      const id= req.params.id
      const {quantityToUpdate,status} =req.body
    
      const filter = {_id : new ObjectId(id)}
      let updateDoc ={
        $inc:{quantity : -quantityToUpdate}
      }
      if(status == "increase"){
        updateDoc ={
          $inc:{quantity: quantityToUpdate}
        }
      }
      const result = await plantCollection.updateOne(filter,updateDoc)
      
      res.send(result)
    })
    //get all orders or a specific customer
    app.get("/customer-orders/:email", verifyToken, async(req,res)=>{
      const email = req.params.email
      const query ={"customer.email": email}
      const result =  await orderCollection.aggregate([
        {
          $match: query //match specific customer email
        },
        {
          $addFields:{
            plantId: {$toObjectId: "$plantId"} //convert string to object id
          }
        },
        {
          //join with plants collection
          $lookup:{
            from: "plants", //collection name
            localField: "plantId", //field name of orders collection
            foreignField: "_id", //field name of plants collection
            as: "plants" //output array field name
          }
        },
        {
          $unwind: "$plants"
        },
        {
          $addFields:{
            name: "$plants.name",
            image: "$plants.image",
            category: "$plants.category",
          }
        },
        {
          $project:{
            //0 mane otake anbo na || 1 mane otake anbo
            //akoi sathe 0,1 kaj korbena sudhu akta kaj korbe 
            //1 use kore onk gula field nite prbo

            plants:0 //remove plants field from order object
          }
        }
      ]).toArray()
      res.send(result)
    })

    //cancel/delete order
    app.delete("/order/:id", verifyToken, async(req,res)=>{
      const id= req.params.id
      const query = {_id: new ObjectId(id)}
      const order = await orderCollection.findOne(query)
      if(order.status == "Delivered"){
       return res.status(409).send({message: "Order already delivered"})
      }
      const result = await orderCollection.deleteOne(query)
      res.send(result)
    })

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from plantNet Server..");
});

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`);
});
