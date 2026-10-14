require('dotenv').config();   
const express = require('express');
const app = express();
//supabase connect
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/', (req, res) => {
  res.render('index', { name: 'Mary' });
});

app.listen(3000, () => console.log('Running on http://localhost:3000'));
