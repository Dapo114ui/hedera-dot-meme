import { createClient } from '@supabase/supabase-js';

const supabaseUrl = "https://qwcuywcuzaygrimnqobh.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3Y3V5d2N1emF5Z3JpbW5xb2JoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk5OTMyMjYsImV4cCI6MjA5NTU2OTIyNn0.qvR2Alm-A47NWLcKUZVsoZDAMrS9yFO0SJxe_rSEIIA";
const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function testSupabase() {
    // Generate a 100KB base64 string
    const largeString = "data:image/jpeg;base64," + "A".repeat(100000);
    
    console.log("Attempting insert...");
    const { data, error } = await supabase.from('meme_tokens').insert([
        {
            token_address: "0xTest" + Math.random().toString(36).substring(7),
            creator_address: "0xCreator",
            name: "Test",
            symbol: "TEST",
            image_url: largeString
        }
    ]);
    
    if (error) {
        console.error("Insert Error:", error);
    } else {
        console.log("Insert Success!", data);
    }
}

testSupabase();
