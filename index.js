// ========== Imports ==========
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

// ========== App Config ==========
const app = express();
const port = 5000;

app.use(express.json());

// ========== CORS Configuration ==========
const allowedOrigins = [
  "http://localhost:5173", // Local dev
  "http://localhost:3000",
  "https://client-gold-nine.vercel.app/extra",
  "https://client-gold-nine.vercel.app",

  // Add your deployed frontend URLs here
  // "https://your-app.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

// ========== MongoDB Setup ==========
const uri = `mongodb+srv://saged-tournament:5sGGh1AE4NTogS76@cluster0.bter72s.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});



// ========== Simple Auth Middleware (using userId from request) ==========
const authenticate = (req, res, next) => {
  const userId = req.headers["x-user-id"];
  if (!userId) {
    return res.status(401).json({ message: "User ID required" });
  }
  req.userId = userId;
  next();
};

// Helper function to detect tournament winner and runner-up
const detectTournamentWinnerAndRunnerUp = (tournament) => {
  const finalMatch = tournament.matches.find((m) => m.stage === "Final");

  if (!finalMatch || !finalMatch.winner) {
    return { winner: null, runnerUp: null };
  }

  const winner =
    finalMatch.winner === finalMatch.team1?._id
      ? finalMatch.team1
      : finalMatch.team2;

  const runnerUp =
    finalMatch.winner === finalMatch.team1?._id
      ? finalMatch.team2
      : finalMatch.team1;

  return { winner, runnerUp };
};

// ========== Main Server Function ==========
async function run() {
  try {
    const db = client.db("cricketLeagueDB");
    const teamsCollection = db.collection("teams");
    const tournamentsCollection = db.collection("tournaments");
    const usersCollection = db.collection("users");

    // ========== User Routes ==========

    // Create or Update User Profile (called after Firebase auth)
    app.post("/users", async (req, res) => {
      try {
        const { uid, email, displayName, photoURL } = req.body;

        if (!uid) {
          return res.status(400).json({ message: "User ID required" });
        }

        const existingUser = await usersCollection.findOne({ uid });

        if (existingUser) {
          // Update existing user
          await usersCollection.updateOne(
            { uid },
            {
              $set: {
                email,
                displayName,
                photoURL,
                lastLogin: new Date(),
              },
            }
          );
          res.json({
            message: "User updated",
            user: { uid, email, displayName, photoURL },
          });
        } else {
          // Create new user
          await usersCollection.insertOne({
            uid,
            email,
            displayName,
            photoURL,
            createdAt: new Date(),
            lastLogin: new Date(),
          });
          res.status(201).json({
            message: "User created",
            user: { uid, email, displayName, photoURL },
          });
        }
      } catch (error) {
        console.error("User creation error:", error);
        res.status(500).json({ message: "Failed to save user" });
      }
    });

    // Get User Profile
    app.get("/users/:uid", async (req, res) => {
      try {
        const { uid } = req.params;
        const user = await usersCollection.findOne({ uid });

        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }

        res.json(user);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch user" });
      }
    });

    // ========== Team Routes ==========

    // Get All Teams
    app.get("/teams", async (req, res) => {
      try {
        const teams = await teamsCollection.find({}).toArray();
        res.json(teams);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch teams" });
      }
    });

    // Add Team
    app.post("/teams", authenticate, async (req, res) => {
      try {
        const { name, color } = req.body;

        if (!name || !color) {
          return res.status(400).json({ message: "Name and color required" });
        }

        const newTeam = {
          name,
          color,
          createdBy: req.userId,
          createdAt: new Date(),
        };

        const result = await teamsCollection.insertOne(newTeam);
        res.status(201).json({
          message: "Team added successfully",
          teamId: result.insertedId,
          team: { ...newTeam, _id: result.insertedId },
        });
      } catch (error) {
        res.status(500).json({ message: "Failed to add team" });
      }
    });

    // Delete Team
    app.delete("/teams/:id", authenticate, async (req, res) => {
      try {
        const { id } = req.params;
        const usedInTournament = await tournamentsCollection.findOne({
          "teams._id": new ObjectId(id),
        });

        if (usedInTournament) {
          return res.status(400).json({
            message: "Cannot delete team that is used in tournaments",
          });
        }

        const result = await teamsCollection.deleteOne({
          _id: new ObjectId(id),
          createdBy: req.userId,
        });

        if (result.deletedCount === 0) {
          return res
            .status(404)
            .json({ message: "Team not found or not authorized" });
        }

        res.json({ message: "Team deleted successfully" });
      } catch (error) {
        res.status(500).json({ message: "Failed to delete team" });
      }
    });

    // ========== Tournament Routes ==========

    // Get All Tournaments (with filters)
    app.get("/tournaments", async (req, res) => {
      try {
        const { search, type, userId } = req.query;
        let query = {};

        if (search) {
          query.name = { $regex: search, $options: "i" };
        }

        if (type && type !== "all") {
          query.type = type;
        }

        if (userId) {
          query.createdBy = userId;
        }

        const tournaments = await tournamentsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.json(tournaments);
      } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Failed to fetch tournaments" });
      }
    });

    // Get Single Tournament
    app.get("/tournaments/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const tournament = await tournamentsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        res.json(tournament);
      } catch (error) {
        res.status(500).json({ message: "Failed to fetch tournament" });
      }
    });

    // Create Tournament
    app.post("/tournaments", authenticate, async (req, res) => {
      try {
        const {
          name,
          type,
          teams,
          matches,
          groups,
          groupCount,
          knockoutStage,
          knockoutFormat,
          hasGroupStage,
        } = req.body;

        if (!name || !type || !teams || teams.length < 2) {
          return res.status(400).json({
            message: "Tournament name, type, and at least 2 teams required",
          });
        }

        // Generate admin code
        const adminCode = Math.random()
          .toString(36)
          .substring(2, 10)
          .toUpperCase();

        const newTournament = {
          name,
          type,
          teams,
          matches: matches || [],
          groups: groups || {},
          adminCode,
          createdBy: req.userId,
          createdAt: new Date(),
          status: "ongoing",
          groupCount: groupCount || 2,
          knockoutStage: knockoutStage || "semi-final",
          knockoutFormat: knockoutFormat || "standard",
          hasGroupStage: hasGroupStage !== undefined ? hasGroupStage : true,
        };

        const result = await tournamentsCollection.insertOne(newTournament);

        res.status(201).json({
          message: "Tournament created successfully",
          tournamentId: result.insertedId,
          adminCode,
          tournament: { ...newTournament, _id: result.insertedId },
        });
      } catch (error) {
        console.error("Tournament creation error:", error);
        res.status(500).json({ message: "Failed to create tournament" });
      }
    });

   
    // Update Knockout Teams (after group/league stage completion)
    app.put("/tournaments/:id/knockout-teams", async (req, res) => {
      try {
        const { id } = req.params;
        const { adminCode, matches } = req.body;

        if (!adminCode) {
          return res.status(400).json({ message: "Admin code required" });
        }

        const tournament = await tournamentsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        if (tournament.adminCode !== adminCode) {
          return res.status(403).json({ message: "Invalid admin code" });
        }

        // Detect winner and runner-up
        const { winner: tournamentWinner, runnerUp: tournamentRunnerUp } =
          detectTournamentWinnerAndRunnerUp({
            ...tournament,
            matches,
          });

        await tournamentsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              matches,
              winner: tournamentWinner,
              runnerUp: tournamentRunnerUp,
              status: tournamentWinner ? "completed" : tournament.status,
            },
          }
        );

        res.json({
          message: "Knockout teams updated successfully",
          winner: tournamentWinner,
          runnerUp: tournamentRunnerUp,
        });
      } catch (error) {
        console.error("Knockout update error:", error);
        res.status(500).json({ message: "Failed to update knockout teams" });
      }
    });

    // Update Match Result
    // Update Match Result
    // app.put("/tournaments/:id/matches/:matchId", async (req, res) => {
    //   try {
    //     const { id, matchId } = req.params;
    //     const { adminCode, winner, team1Score, team2Score } = req.body;

    //     if (!adminCode) {
    //       return res.status(400).json({ message: "Admin code required" });
    //     }

    //     const tournament = await tournamentsCollection.findOne({
    //       _id: new ObjectId(id),
    //     });

    //     if (!tournament) {
    //       return res.status(404).json({ message: "Tournament not found" });
    //     }

    //     if (tournament.adminCode !== adminCode) {
    //       return res.status(403).json({ message: "Invalid admin code" });
    //     }

    //     // Update the specific match - using _id instead of id
    //     const updatedMatches = tournament.matches.map((match) => {
    //       if (match._id === matchId) {
    //         return {
    //           ...match,
    //           winner,
    //           team1Score: team1Score || match.team1Score,
    //           team2Score: team2Score || match.team2Score,
    //         };
    //       }
    //       return match;
    //     });

    //     await tournamentsCollection.updateOne(
    //       { _id: new ObjectId(id) },
    //       { $set: { matches: updatedMatches } }
    //     );

    //     res.json({ message: "Match result updated successfully" });
    //   } catch (error) {
    //     console.error("Match update error:", error);
    //     res.status(500).json({ message: "Failed to update match result" });
    //   }
    // });

    // replaced with down code ------>
    // Update Match Result
    app.put("/tournaments/:id/matches/:matchId", async (req, res) => {
      try {
        const { id, matchId } = req.params;
        const { adminCode, winner, team1Score, team2Score } = req.body;

        if (!adminCode) {
          return res.status(400).json({ message: "Admin code required" });
        }

        const tournament = await tournamentsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        if (tournament.adminCode !== adminCode) {
          return res.status(403).json({ message: "Invalid admin code" });
        }

        // Update the specific match
        const updatedMatches = tournament.matches.map((match) => {
          if (match._id === matchId) {
            return {
              ...match,
              winner,
              team1Score: team1Score || match.team1Score,
              team2Score: team2Score || match.team2Score,
            };
          }
          return match;
        });

        // Detect winner and runner-up
        const { winner: tournamentWinner, runnerUp: tournamentRunnerUp } =
          detectTournamentWinnerAndRunnerUp({
            ...tournament,
            matches: updatedMatches,
          });

        // Update tournament with new match results and winner/runner-up
        await tournamentsCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: {
              matches: updatedMatches,
              winner: tournamentWinner,
              runnerUp: tournamentRunnerUp,
              status: tournamentWinner ? "completed" : tournament.status,
            },
          }
        );

        res.json({
          message: "Match result updated successfully",
          winner: tournamentWinner,
          runnerUp: tournamentRunnerUp,
        });
      } catch (error) {
        console.error("Match update error:", error);
        res.status(500).json({ message: "Failed to update match result" });
      }
    });
    // Delete Tournament
    app.delete("/tournaments/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const { adminCode } = req.body;

        if (!adminCode) {
          return res.status(400).json({ message: "Admin code required" });
        }

        const tournament = await tournamentsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        if (tournament.adminCode !== adminCode) {
          return res.status(403).json({ message: "Invalid admin code" });
        }

        await tournamentsCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ message: "Tournament deleted successfully" });
      } catch (error) {
        res.status(500).json({ message: "Failed to delete tournament" });
      }
    });

    // Update Tournament Status
    app.patch("/tournaments/:id/status", async (req, res) => {
      try {
        const { id } = req.params;
        const { adminCode, status } = req.body;

        if (!adminCode || !status) {
          return res
            .status(400)
            .json({ message: "Admin code and status required" });
        }

        const tournament = await tournamentsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        if (tournament.adminCode !== adminCode) {
          return res.status(403).json({ message: "Invalid admin code" });
        }

        await tournamentsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        res.json({ message: "Tournament status updated successfully" });
      } catch (error) {
        res.status(500).json({ message: "Failed to update tournament status" });
      }
    });

    // Verify Admin Code
    app.post("/tournaments/:id/verify-admin", async (req, res) => {
      try {
        const { id } = req.params;
        const { adminCode } = req.body;

        const tournament = await tournamentsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!tournament) {
          return res.status(404).json({ message: "Tournament not found" });
        }

        const isValid = tournament.adminCode === adminCode;
        res.json({ valid: isValid });
      } catch (error) {
        res.status(500).json({ message: "Failed to verify admin code" });
      }
    });

    // MongoDB ping check
    await client.db("admin").command({ ping: 1 });
    console.log("✅ Successfully connected to MongoDB!");
  } finally {
    // Don't close the client in serverless environments
    // await client.close();
  }
}

run().catch(console.dir);

// ========== Root Route ==========
app.get("/", (req, res) => {
  res.send("🏏 Cricket League API is running");
});

// ========== Health Check ==========
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

// ========== Error Handling Middleware ==========
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something went wrong!" });
});

// ========== Serverless Export (Uncomment for Vercel/Netlify) ==========
// module.exports = app;
// module.exports.handler = require('serverless-http')(app);

// ========== Local Server ==========
if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`🏏 Cricket League API is running on port ${port}`);
  });
}

module.exports = app;
