import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './Home.css';
import { MapView } from '../../components/Map/MapView';
import { TravelBehaviourForm } from '../../components/TravelBehaviourForm/TravelBehaviourForm';
import { auth, db } from "../../firebase";
import { 
  doc, 
  setDoc, 
  getDoc, 
  updateDoc,
  arrayUnion,
  arrayRemove 
} from 'firebase/firestore';
import { useAuth } from "../../contexts/AuthContext";

function Home() {
  console.log("🏠 Home: Component mounting");
  const navigate = useNavigate();
  const [searchResults, setSearchResults] = useState([]);
  const [selectedCity, setSelectedCity] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [targetPostcode, setTargetPostcode] = useState(null);
  const { currentUser } = useAuth();
  const [savedPostcodes, setSavedPostcodes] = useState([]);
  const [travelPreferences, setTravelPreferences] = useState(null);
  const [locationLabel, setLocationLabel] = useState("");
  const [postcode, setPostcode] = useState("");
  const [locationType, setLocationType] = useState("Home");
  const [showScoreExplanation, setShowScoreExplanation] = useState(false);

  console.log('savedPostcodes in Home:', savedPostcodes);

  // Load saved data when user logs in
  useEffect(() => {
    const loadUserData = async () => {
      if (!currentUser) {
        console.log('No user logged in during load');
        setSavedPostcodes([]); // Clear saved postcodes
        setTravelPreferences(null); // Clear travel preferences
        return;
      }
      
      try {
        console.log('Loading data for user:', currentUser.uid);
        const userDoc = doc(db, 'users', currentUser.uid);
        const docSnap = await getDoc(userDoc);
        
        if (docSnap.exists()) {
          const userData = docSnap.data();
          console.log('Loaded user data:', userData);
          setSavedPostcodes(userData.savedPostcodes || []);
          // Load saved travel preferences with default weights if not present
          if (userData.travelPreferences) {
            console.log('Loading travel preferences:', userData.travelPreferences);
            const locations = Array.isArray(userData.travelPreferences)
              ? userData.travelPreferences
              : (userData.travelPreferences.locations || []);
            
            // Ensure types are preserved exactly as they are in Firebase
            const processedLocations = locations.map(loc => {
              // Ensure type is properly set with a default if missing
              const type = loc.type || 'Home';
              return {
                ...loc,
                type: type,  // Use the validated type
                frequency: loc.frequency || 1  // Ensure frequency is never undefined
              };
            });
            
            console.log('Processed locations with types:', processedLocations.map(loc => ({ 
              postcode: loc.postcode, 
              type: loc.type, 
              frequency: loc.frequency 
            })));
            
            setTravelPreferences({
              locations: processedLocations,
              amenityWeights: userData.travelPreferences.amenityWeights || {
                school: 15,
                hospital: 15,
                supermarket: 10
              }
            });
          }
        } else {
          console.log('Creating new user document');
          await setDoc(userDoc, { 
            savedPostcodes: [],
            travelPreferences: {
              locations: [],
              amenityWeights: {
                school: 15,
                hospital: 15,
                supermarket: 10
              }
            },
            createdAt: new Date().toISOString(),
            email: currentUser.email
          });
        }
      } catch (error) {
        console.error('Error loading user data:', error);
      }
    };

    loadUserData();
  }, [currentUser]);

  // Handle adding a new postcode
  const handlePostcodeSubmit = async () => {
    if (!currentUser) {
      alert('Please log in to save postcodes');
      return;
    }

    if (!locationLabel || !postcode) {
      alert('Please enter both a label and postcode');
      return;
    }

    try {
      console.log('Geocoding postcode:', postcode);
      // First, geocode the postcode
      const response = await fetch(`https://api.postcodes.io/postcodes/${postcode}`);
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error('Invalid postcode');
      }

      const { latitude, longitude } = data.result;
      
      console.log('Saving postcode for user:', currentUser.uid);
      const userDoc = doc(db, 'users', currentUser.uid);
      const newPostcode = {
        id: Date.now().toString(),
        label: locationLabel,
        postcode: postcode,
        type: locationType,
        lat: latitude,
        lng: longitude,
        timestamp: new Date().toISOString()
      };

      await updateDoc(userDoc, {
        savedPostcodes: arrayUnion(newPostcode)
      });

      setSavedPostcodes(prev => [...prev, newPostcode]);
      setLocationLabel("");
      setPostcode("");
      setLocationType("Home");
      console.log('Postcode saved successfully');
    } catch (error) {
      console.error('Error saving postcode:', error);
      alert(error.message || 'Error saving postcode. Please try again.');
    }
  };

  // Handle removing a postcode
  const handleRemovePostcode = async (postcodeId) => {
    if (!currentUser) return;

    try {
      const postcodeToRemove = savedPostcodes.find(pc => pc.id === postcodeId);
      const userDoc = doc(db, 'users', currentUser.uid);
      
      await updateDoc(userDoc, {
        savedPostcodes: arrayRemove(postcodeToRemove)
      });

      setSavedPostcodes(prev => prev.filter(pc => pc.id !== postcodeId));
    } catch (error) {
      console.error('Error removing postcode:', error);
    }
  };

  const handleSearch = async () => {
    if (!selectedCity) {
      setError("Please enter a city name");
      return;
    }

    setIsLoading(true);
    setError(null);
    setHasSearched(true);

    try {
      // Debug log travel preferences before sending
      console.log("Sending travel preferences to server:", travelPreferences);
      
      // Make API call without requiring travel preferences
      const response = await axios.get(`http://localhost:5000/amenities`, {
        params: {
          city: selectedCity,
          travel_preferences: JSON.stringify(travelPreferences)  // Stringify the preferences object
        }
      });

      if (response.data && response.data.locations) {
        // Debug log received data
        console.log("Received data from server:", response.data);
        processResults(response.data.locations);
      } else {
        setError("No results found");
        setSearchResults([]);
      }
    } catch (err) {
      console.error("Error during search:", err);
      setError(err.response?.data?.message || "An error occurred during search");
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTravelPreferences = async (preferences) => {
    console.log("🔍 DEBUG: Received preferences from form:", JSON.stringify(preferences, null, 2));
    console.log("🔍 DEBUG: Types in received preferences:", preferences.locations.map(loc => ({ 
      postcode: loc.postcode, 
      type: loc.type, 
      frequency: loc.frequency 
    })));
    
    try {
      // Geocode all postcodes using the same implementation as handlePostcodeSubmit
      const geocodedPreferences = await Promise.all(
        preferences.locations.map(async (pref) => {
          if (!pref.postcode) return null;
          
          console.log("🔍 DEBUG: Processing preference:", JSON.stringify(pref, null, 2));
          
          const response = await fetch(`https://api.postcodes.io/postcodes/${pref.postcode}`);
          const data = await response.json();
          
          if (!response.ok) {
            console.error(`Failed to geocode postcode ${pref.postcode}`);
            return null;
          }

          const { latitude, longitude } = data.result;
          
          // Important! Use the exact type value without any modification
          return {
            ...pref,
            // No type validation or default here - use the exact type from the form
            lat: latitude,
            lng: longitude,
            timestamp: new Date().toISOString(),
            id: `${pref.type}-${pref.postcode}`,  // Use the exact type in the ID
            frequency: pref.frequency || 1  // Ensure frequency is never undefined
          };
        })
      );

      // Filter out null results
      const validGeocoded = geocodedPreferences.filter(pref => pref !== null);
      console.log("🔍 DEBUG: Valid geocoded preferences:", JSON.stringify(validGeocoded, null, 2));
      console.log("🔍 DEBUG: Types in geocoded preferences:", validGeocoded.map(loc => ({ 
        postcode: loc.postcode, 
        type: loc.type, 
        frequency: loc.frequency 
      })));

      // Create the complete preferences object with both locations and weights
      const completePreferences = {
        locations: validGeocoded,
        amenityWeights: preferences.amenityWeights
      };

      console.log("🔍 DEBUG: Complete preferences:", JSON.stringify(completePreferences, null, 2));
      // Save preferences to state
      setTravelPreferences(completePreferences);

      // Save preferences to Firebase if user is logged in
      if (currentUser) {
        try {
          console.log("Saving travel preferences to Firebase for user:", currentUser.uid);
          console.log("🔍 DEBUG: Types being saved to Firebase:", validGeocoded.map(loc => ({ 
            postcode: loc.postcode, 
            type: loc.type, 
            frequency: loc.frequency 
          })));
          
          const userDoc = doc(db, 'users', currentUser.uid);
          await updateDoc(userDoc, {
            travelPreferences: completePreferences
          });
          console.log("Travel preferences saved successfully");
          
          // Trigger new search if city is already selected
          if (selectedCity) {
            handleSearch();
          }
        } catch (error) {
          console.error("Error saving travel preferences:", error);
          alert("Failed to save travel preferences. Please try again.");
        }
      } else {
        console.log("No user logged in, preferences will not be persisted");
        // Still trigger search even if not logged in
        if (selectedCity) {
          handleSearch();
        }
      }
    } catch (error) {
      console.error("Error processing travel preferences:", error);
      alert("Failed to process travel preferences. Please try again.");
    }
  };

  const processResults = (results) => {
    try {
      console.log("Processing results:", results);
      const processedResults = results.map((location, index) => {
        if (!location) {
          console.error("❌ Invalid location data at index", index);
          return null;
        }

        console.log(`Processing location ${index}:`, location);

        return {
          id: index + 1,
          score: location.score || 0,
          area_name: location.area_name || "Unknown Location",
          amenities: location.amenities || {},
          travel_scores: location.travel_scores || {},  // New field
          lat: location.lat || 0,
          lon: location.lon || 0,
          google_maps_link: location.google_maps_link || 
            `https://www.google.com/maps?q=${location.lat},${location.lon}`,
          category: location.category || "Recommended Location",
          name: location.name || `Location ${index + 1}`,
          reason: location.reason || "",
          transit: location.transit || { score: 0, accessible_routes: [] },
          score_breakdown: location.score_breakdown || {  // Add score_breakdown
            travel: 0,
            amenities: { total: 0 },
            transit: { score: 0 }
          }
        };
      }).filter(Boolean);

      console.log("✅ Processed results:", processedResults);
      
      if (processedResults.length > 0) {
        console.log("Setting search results:", processedResults);
        setSearchResults(processedResults);
        setError(null);
      } else {
        setSearchResults([]);
        setError("No valid locations found in the response");
      }
    } catch (err) {
      console.error("❌ Error processing results:", err);
      setError("Error processing search results");
      setSearchResults([]);
    }
  };

  // Debug logging
  useEffect(() => {
    console.log("Current state:", {
      resultsCount: searchResults.length,
      hasSearched,
      selectedCity,
      isLoading,
      error
    });
  }, [searchResults, hasSearched, selectedCity, isLoading, error]);

  console.log("🎨 Home: Rendering content");
  return (
    <div className="home-page">
      <div className="hero-section">
        <h1 className="hero-title">Find Your Ideal Location</h1>
        <p className="hero-subtitle">
          Discover the perfect area based on your daily activities and travel preferences
        </p>
        
        <div className="search-container">
          <input
            type="text"
            placeholder="Enter a city name (e.g., Cardiff, UK)"
            value={selectedCity}
            onChange={(e) => setSelectedCity(e.target.value)}
            className="city-input"
          />
          <button onClick={handleSearch} className="search-button">
            Search
          </button>
        </div>

        <TravelBehaviourForm 
          onSubmit={handleTravelPreferences}
          savedPreferences={travelPreferences}
        />

        {currentUser && (
          <div className="saved-locations-container">
            <div className="add-location-form">
              <input
                type="text"
                placeholder="Location label (e.g., Home)"
                className="location-label-input"
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
              />
              <input
                type="text"
                placeholder="Enter postcode"
                className="postcode-input"
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
              />
              <select 
                className="location-type-select"
                value={locationType}
                onChange={(e) => setLocationType(e.target.value)}
              >
                <option value="Home">Home</option>
                <option value="Work">Work</option>
                <option value="School">School</option>
                <option value="Other">Other</option>
              </select>
              <button 
                className="add-location-btn"
                onClick={handlePostcodeSubmit}
              >
                Add Location
              </button>
            </div>

            <div className="saved-postcodes-container">
              <h3>Saved Postcodes</h3>
              <div className="saved-postcodes-list">
                {savedPostcodes.map((postcode, index) => (
                  <div key={index} className="saved-postcode-item">
                    <span className="postcode-label">
                      {postcode.label} - {postcode.postcode}
                    </span>
                    <button
                      onClick={() => handleRemovePostcode(postcode.id)}
                      className="remove-postcode-btn"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>Analyzing locations...</p>
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {hasSearched && !isLoading && !error && (
        <div className="map-section">
          <div className="map-container">
            <MapView 
              city={selectedCity} 
              locations={searchResults}
              savedPostcodes={[
                ...savedPostcodes,
                ...(travelPreferences?.locations.map(pref => ({
                  id: `travel-${pref.type}-${pref.postcode}`,
                  label: `${pref.type} (${pref.frequency}x/week)`,
                  postcode: pref.postcode,
                  type: pref.type,
                  transportMode: pref.transportMode,
                  frequency: pref.frequency,
                  lat: pref.lat,
                  lng: pref.lng
                })) || [])
              ]}
            />
          </div>

          {searchResults.length === 0 ? (
            <div className="no-results">
              <p>No locations found for {selectedCity}. Try searching for a different city.</p>
            </div>
          ) : (
            <div className="results-section">
              <h2>Top {searchResults.length} Locations in {selectedCity.split(',')[0]}</h2>
              
              {/* Score Explanation Toggle Button */}
              <div className="score-explanation-toggle">
                <button 
                  onClick={() => setShowScoreExplanation(!showScoreExplanation)}
                  className="toggle-explanation-btn"
                >
                  {showScoreExplanation ? 'Hide Score Explanation' : 'Show Score Explanation'}
                </button>
              </div>
              
              {/* Score Explanation Box */}
              {showScoreExplanation && (
                <div className="score-explanation-box">
                  <h3>How We Calculate Scores</h3>
                  
                  {/* Score Interpretation Guide */}
                  <div className="score-interpretation">
                    <h4>Understanding Your Score</h4>
                    <div className="score-ranges">
                      <div className="score-range excellent">
                        <span className="range">90-100</span>
                        <span className="label">Excellent</span>
                        <p>Perfect location with minimal travel time, excellent amenities, and great public transport</p>
                      </div>
                      <div className="score-range good">
                        <span className="range">75-89</span>
                        <span className="label">Very Good</span>
                        <p>Strong choice with good balance of travel times and amenities</p>
                      </div>
                      <div className="score-range average">
                        <span className="range">60-74</span>
                        <span className="label">Good</span>
                        <p>Decent location with reasonable travel times and access to basic amenities</p>
                      </div>
                      <div className="score-range below-average">
                        <span className="range">40-59</span>
                        <span className="label">Fair</span>
                        <p>Some compromises in either travel time or amenity access</p>
                      </div>
                      <div className="score-range poor">
                        <span className="range">0-39</span>
                        <span className="label">Needs Improvement</span>
                        <p>Significant travel time or limited access to essential amenities</p>
                      </div>
                    </div>
                  </div>

                  <div className="score-breakdown">
                    <div className="score-component">
                      <h4>Amenities (40%)</h4>
                      <ul>
                        <li>Schools (15%): Based on distance to nearest school</li>
                        <li>Hospitals (4%): Based on distance to nearest hospital</li>
                        <li>Supermarkets (21%): Based on distance to nearest supermarket</li>
                      </ul>
                    </div>
                    <div className="score-component">
                      <h4>Public Transport (20%)</h4>
                      <ul>
                        <li>Based on number of accessible bus routes</li>
                        <li>Distance to nearest bus stop</li>
                      </ul>
                    </div>
                    <div className="score-component">
                      <h4>Travel Behavior (40%)</h4>
                      <ul>
                        <li>Calculated using real driving times from OSRM</li>
                        <li>Weighted by visit frequency (more frequent trips have higher impact)</li>
                        <li>Target: Keep daily travel time under 120 minutes</li>
                        <li>Score decreases as daily travel time approaches or exceeds target</li>
                      </ul>
                    </div>
                  </div>
                  <div className="score-tips">
                    <h4>Tips for Interpreting Scores</h4>
                    <ul>
                      <li>A score above 75 indicates an excellent location that meets most of your needs</li>
                      <li>Daily travel time over 120 minutes significantly impacts the travel score</li>
                      <li>Amenities within 1km (2km for hospitals) receive the highest scores</li>
                      <li>More bus routes and closer stops improve the transit score</li>
                    </ul>
                  </div>
                </div>
              )}
              
              <div className="location-cards">
                {searchResults.map((location, index) => (
                  <div key={index} className="location-card">
                    <h3>Location {index + 1}</h3>
                    <div className="score-container">
                      <p className="score">Score: {location.score}/100</p>
                      <button 
                        className="score-info-btn"
                        onClick={() => setShowScoreExplanation(true)}
                        title="Learn how this score is calculated"
                      >
                        <span className="info-icon">ⓘ</span>
                      </button>
                    </div>
                    <p>Area: {location.area_name}</p>

                    {/* Travel Analysis Section */}
                    {Object.keys(location.travel_scores || {}).length > 0 && (
                      <div className="travel-summary-box">
                        <h4>Travel & Transit Analysis</h4>
                        <div className="travel-metrics">
                          <div className="metric">
                            <span className="metric-label">Daily Travel:</span>
                            <span className="metric-value">
                              {Math.round(Object.values(location.travel_scores)
                                .reduce((total, data) => total + ((data.travel_time || 0) * (data.frequency || 1)), 0) / 5)} mins
                            </span>
                          </div>
                          <div className="metric">
                            <span className="metric-label">Transit Score:</span>
                            <span className="metric-value">
                              {location.transit?.score || 0}/100 ({location.transit?.accessible_routes?.length || 0} routes)
                            </span>
                          </div>
                        </div>

                        <div className="travel-destinations">
                          <h5>Journey Details:</h5>
                          <ul>
                            {travelPreferences?.locations.map(pref => {
                              const key = `${pref.type}-${pref.postcode}`;
                              const data = location.travel_scores[key];
                              if (!data) return null;
                              
                              return (
                                <li key={key} className="journey-detail">
                                  <div className="journey-header">
                                    <div className="journey-title">
                                      <strong>{pref.type}</strong>
                                      <span className="journey-postcode"> - {pref.postcode}</span>
                                    </div>
                                    <span className="journey-frequency">{pref.frequency}x per week</span>
                                  </div>
                                  <div className="journey-stats">
                                    <span>Single trip: {Math.round(data.travel_time || 0)} mins</span>
                                    <span>Weekly total: {Math.round((data.travel_time || 0) * (pref.frequency || 1))} mins</span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>
                    )}

                    {/* Score Breakdown Section */}
                    <div className="score-breakdown-card">
                      <h4>Score Breakdown</h4>
                      <div className="score-components">
                        <div className="score-component-item">
                          <span>Travel (40%):</span>
                          <span>{location.score_breakdown?.travel || 0}</span>
                        </div>
                        <div className="score-component-item">
                          <span>Amenities (40%):</span>
                          <span>{Math.round(location.score_breakdown?.amenities?.total || 0)}</span>
                        </div>
                        <div className="score-component-item">
                          <span>Transit (20%):</span>
                          <span>{Math.round(location.score_breakdown?.transit?.score || 0)}</span>
                        </div>
                        <div className="total-score">
                          <span>Final Score:</span>
                          <span>{location.score || 0}</span>
                        </div>
                      </div>

                      {/* Amenities Section */}
                      {Object.keys(location.amenities || {}).length > 0 && (
                        <div className="amenities-section">
                          <h5>Nearby Amenities:</h5>
                          <ul className="amenities-list">
                            {Object.entries(location.amenities || {}).map(([type, amenity]) => {
                              if (!amenity || !amenity.weight) return null;
                              return (
                                <li key={type}>
                                  <span className="amenity-type">{type}:</span>
                                  <div className="amenity-details">
                                    <span>{amenity.name || type} ({amenity.distance}m)</span>
                                    <span className="amenity-score">Score: {amenity.score.toFixed(1)}/{amenity.weight}</span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}
                    </div>
                    
                    <a 
                      href={location.google_maps_link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="maps-link"
                    >
                      View on Google Maps
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="features-section">
        <h2 className="section-title">How It Works</h2>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">🎯</div>
            <h3>Set Your Preferences</h3>
            <p>Add your frequent destinations and travel habits</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">🔍</div>
            <h3>Smart Search</h3>
            <p>Our algorithm analyzes travel times and amenities</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">📊</div>
            <h3>Compare Locations</h3>
            <p>View detailed scores and travel times for each area</p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">🚌</div>
            <h3>Transport Options</h3>
            <p>Consider multiple transport modes for your journeys</p>
          </div>
        </div>
      </div>
      
      {searchResults.length > 0 && (
        <div className="cta-section">
          <h2>Want to see more details?</h2>
          <p>Check out our full-screen map view for an enhanced experience</p>
          <button 
            onClick={() => {
              console.log("🖱️ Home: Map exploration button clicked");
              // Store current results before navigating
              sessionStorage.setItem("searchResults", JSON.stringify(searchResults));
              navigate("/map");
            }} 
            className="cta-button"
          >
            Open Full Map View
          </button>
        </div>
      )}
    </div>
  );
}

export default Home; 