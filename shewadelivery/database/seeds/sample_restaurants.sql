-- Seed: sample_restaurants.sql
-- Description: Sample restaurants for development and testing

-- Sample restaurants in Addis Ababa
INSERT INTO restaurants (name, description, cuisine, city, sub_city, address, phone, delivery_fee, minimum_order, rating, is_open) VALUES
('Ethiopian Delight', 'Authentic Ethiopian cuisine served in a traditional atmosphere', ARRAY['Ethiopian', 'Local'], 'Addis Ababa', 'Bole', 'Bole Road, Near Friendship Mall', '+251911234567', 30, 50, 4.5, true),
('Pizza Haven', 'Best Italian pizza in town with fresh ingredients', ARRAY['Italian', 'Pizza'], 'Addis Ababa', 'Kazanchis', 'Kazanchis Business District', '+251912345678', 40, 100, 4.3, true),
('Burger Stop', 'Juicy burgers, crispy fries, and refreshing drinks', ARRAY['American', 'Fast Food'], 'Addis Ababa', 'Kirkos', 'Kirkos Square', '+251913456789', 35, 80, 4.2, true),
('Spice Garden', 'Authentic Indian and Chinese fusion cuisine', ARRAY['Indian', 'Chinese'], 'Addis Ababa', 'Bole', 'Bole Medhanialem', '+251914567890', 45, 120, 4.4, true),
('Coffee & Buna', 'Traditional Ethiopian coffee and pastries', ARRAY['Cafe', 'Beverages'], 'Addis Ababa', 'Arada', 'Piassa Area', '+251915678901', 25, 30, 4.6, true),
('Seafood House', 'Fresh fish and seafood from Lake Tana', ARRAY['Seafood'], 'Addis Ababa', 'Bole', 'Bole Atlas', '+251916789012', 50, 150, 4.1, true),
('Vegetarian Paradise', 'Delicious plant-based Ethiopian cuisine', ARRAY['Vegetarian', 'Ethiopian'], 'Addis Ababa', 'Yeka', 'Yeka Sub-city', '+251917890123', 30, 60, 4.3, true),
('BBQ Corner', 'Grilled meats and BBQ specialties', ARRAY['Grill', 'American'], 'Addis Ababa', 'Gulele', 'Gulele Sub-city', '+251918901234', 40, 100, 4.0, true),

-- Bahir Dar restaurants
('Lake Tana Fish Restaurant', 'Fresh fish from Lake Tana', ARRAY['Seafood', 'Local'], 'Bahir Dar', 'Kebele 03', 'Lake Tana Shore', '+251919012345', 35, 80, 4.4, true),
('Bahir Dar Pizza', 'Italian pizza with local flavors', ARRAY['Italian', 'Pizza'], 'Bahir Dar', 'Kebele 02', 'Main Square', '+251920123456', 40, 100, 4.2, true),

-- Dire Dawa restaurants
('Dire Dawa Buna', 'Traditional coffee and snacks', ARRAY['Cafe', 'Local'], 'Dire Dawa', 'Kebele 01', 'Main Road', '+251921234567', 30, 40, 4.3, true),
('Eastern Delight', 'Middle Eastern and local cuisine', ARRAY['Local', 'Fast Food'], 'Dire Dawa', 'Kebele 02', 'Railway Station Area', '+251922345678', 35, 70, 4.1, true),

-- Mekelle restaurants
('Mekelle Traditional', 'Authentic Tigray cuisine', ARRAY['Ethiopian', 'Local'], 'Mekelle', 'Kebele 03', 'Martyrs Avenue', '+251923456789', 35, 60, 4.5, true),
('City Fast Food', 'Quick bites and fast food', ARRAY['Fast Food'], 'Mekelle', 'Kebele 01', 'City Center', '+251924567890', 30, 50, 4.0, true);

-- Sample menu items for Ethiopian Delight
INSERT INTO menu_items (restaurant_id, name, description, price, category, is_popular, preparation_time) VALUES
((SELECT id FROM restaurants WHERE name = 'Ethiopian Delight' LIMIT 1), 
 'Doro Wat', 'Spicy chicken stew with boiled egg', 180, 'Main', true, 25),
((SELECT id FROM restaurants WHERE name = 'Ethiopian Delight' LIMIT 1), 
 'Kitfo', 'Minced raw beef with spices', 200, 'Main', true, 20),
((SELECT id FROM restaurants WHERE name = 'Ethiopian Delight' LIMIT 1), 
 'Tibs', 'Sautéed beef with vegetables', 160, 'Main', false, 20),
((SELECT id FROM restaurants WHERE name = 'Ethiopian Delight' LIMIT 1), 
 'Injera', 'Traditional Ethiopian flatbread', 25, 'Bread', true, 5),
((SELECT id FROM restaurants WHERE name = 'Ethiopian Delight' LIMIT 1), 
 'Shiro Wat', 'Chickpea stew', 120, 'Vegetarian', true, 15);

-- Sample menu items for Pizza Haven
INSERT INTO menu_items (restaurant_id, name, description, price, category, is_popular, preparation_time) VALUES
((SELECT id FROM restaurants WHERE name = 'Pizza Haven' LIMIT 1), 
 'Margherita Pizza', 'Fresh mozzarella, tomato sauce, basil', 250, 'Pizza', true, 15),
((SELECT id FROM restaurants WHERE name = 'Pizza Haven' LIMIT 1), 
 'Pepperoni Pizza', 'Spicy pepperoni, mozzarella, tomato sauce', 300, 'Pizza', true, 15),
((SELECT id FROM restaurants WHERE name = 'Pizza Haven' LIMIT 1), 
 'Hawaiian Pizza', 'Ham, pineapple, mozzarella', 280, 'Pizza', false, 15),
((SELECT id FROM restaurants WHERE name = 'Pizza Haven' LIMIT 1), 
 'Garlic Bread', 'Toasted bread with garlic butter', 60, 'Sides', false, 5);

-- Sample menu items for Burger Stop
INSERT INTO menu_items (restaurant_id, name, description, price, category, is_popular, preparation_time) VALUES
((SELECT id FROM restaurants WHERE name = 'Burger Stop' LIMIT 1), 
 'Classic Cheeseburger', 'Beef patty, cheddar cheese, lettuce, tomato', 150, 'Burgers', true, 10),
((SELECT id FROM restaurants WHERE name = 'Burger Stop' LIMIT 1), 
 'Double Burger', 'Double beef patty, double cheese', 220, 'Burgers', true, 12),
((SELECT id FROM restaurants WHERE name = 'Burger Stop' LIMIT 1), 
 'Chicken Burger', 'Grilled chicken, lettuce, mayo', 140, 'Burgers', false, 10),
((SELECT id FROM restaurants WHERE name = 'Burger Stop' LIMIT 1), 
 'French Fries', 'Crispy golden fries', 50, 'Sides', true, 5),
((SELECT id FROM restaurants WHERE name = 'Burger Stop' LIMIT 1), 
 'Milkshake', 'Vanilla, chocolate, or strawberry', 80, 'Beverages', false, 5);