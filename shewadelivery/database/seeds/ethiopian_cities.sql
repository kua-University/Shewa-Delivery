 
-- Seed: ethiopian_cities.sql
-- Description: Ethiopian cities and delivery zones
-- ASR-10: Support for multiple Ethiopian cities

-- Insert Ethiopian cities
INSERT INTO delivery_zones (city, sub_city, delivery_fee, minimum_order, estimated_time_min, estimated_time_max, is_active) VALUES
-- Addis Ababa (Major sub-cities)
('Addis Ababa', 'Bole', 30, 50, 25, 45, true),
('Addis Ababa', 'Kazanchis', 30, 50, 20, 40, true),
('Addis Ababa', 'Kirkos', 30, 50, 20, 40, true),
('Addis Ababa', 'Lideta', 35, 50, 25, 45, true),
('Addis Ababa', 'Arada', 35, 50, 25, 45, true),
('Addis Ababa', 'Gulele', 40, 50, 30, 50, true),
('Addis Ababa', 'Kolfe Keranio', 40, 50, 35, 55, true),
('Addis Ababa', 'Nifas Silk-Lafto', 40, 60, 35, 55, true),
('Addis Ababa', 'Yeka', 35, 50, 25, 50, true),
('Addis Ababa', 'Addis Ketema', 35, 50, 25, 45, true),
('Addis Ababa', 'Akaki Kality', 45, 60, 40, 60, true),
('Addis Ababa', 'Lemi Kura', 40, 60, 35, 55, true),

-- Bahir Dar
('Bahir Dar', 'Kebele 01', 35, 50, 20, 40, true),
('Bahir Dar', 'Kebele 02', 35, 50, 20, 40, true),
('Bahir Dar', 'Kebele 03', 35, 50, 20, 40, true),
('Bahir Dar', 'Kebele 04', 35, 50, 25, 45, true),
('Bahir Dar', 'Kebele 05', 35, 50, 25, 45, true),
('Bahir Dar', 'Kebele 06', 40, 50, 25, 45, true),
('Bahir Dar', 'Kebele 07', 40, 50, 30, 50, true),
('Bahir Dar', 'Kebele 08', 40, 60, 30, 50, true),
('Bahir Dar', 'Kebele 09', 40, 60, 30, 50, true),

-- Dire Dawa
('Dire Dawa', 'Kebele 01', 35, 50, 20, 40, true),
('Dire Dawa', 'Kebele 02', 35, 50, 20, 40, true),
('Dire Dawa', 'Kebele 03', 35, 50, 25, 45, true),
('Dire Dawa', 'Kebele 04', 35, 50, 25, 45, true),
('Dire Dawa', 'Kebele 05', 40, 50, 25, 45, true),
('Dire Dawa', 'Kebele 06', 40, 60, 30, 50, true),

-- Mekelle
('Mekelle', 'Kebele 01', 35, 50, 20, 40, true),
('Mekelle', 'Kebele 02', 35, 50, 20, 40, true),
('Mekelle', 'Kebele 03', 35, 50, 25, 45, true),
('Mekelle', 'Kebele 04', 35, 50, 25, 45, true),
('Mekelle', 'Kebele 05', 40, 50, 25, 45, true),
('Mekelle', 'Kebele 06', 40, 60, 30, 50, true),

-- Gondar
('Gondar', 'Kebele 01', 35, 50, 20, 40, true),
('Gondar', 'Kebele 02', 35, 50, 20, 40, true),
('Gondar', 'Kebele 03', 35, 50, 25, 45, true),
('Gondar', 'Kebele 04', 40, 50, 25, 45, true),
('Gondar', 'Kebele 05', 40, 60, 30, 50, true),

-- Hawassa
('Hawassa', 'Kebele 01', 35, 50, 20, 40, true),
('Hawassa', 'Kebele 02', 35, 50, 20, 40, true),
('Hawassa', 'Kebele 03', 35, 50, 25, 45, true),
('Hawassa', 'Kebele 04', 40, 50, 25, 45, true),
('Hawassa', 'Kebele 05', 40, 60, 30, 50, true),

-- Jimma
('Jimma', 'Kebele 01', 40, 60, 25, 45, true),
('Jimma', 'Kebele 02', 40, 60, 25, 45, true),
('Jimma', 'Kebele 03', 40, 60, 30, 50, true),
('Jimma', 'Kebele 04', 45, 70, 30, 50, true),

-- Adama (Nazret)
('Adama', 'Kebele 01', 35, 50, 20, 40, true),
('Adama', 'Kebele 02', 35, 50, 20, 40, true),
('Adama', 'Kebele 03', 35, 50, 25, 45, true),
('Adama', 'Kebele 04', 40, 60, 25, 45, true),

-- Dessie
('Dessie', 'Kebele 01', 40, 60, 25, 45, true),
('Dessie', 'Kebele 02', 40, 60, 25, 45, true),
('Dessie', 'Kebele 03', 40, 60, 30, 50, true),

-- Harar
('Harar', 'Kebele 01', 40, 60, 25, 45, true),
('Harar', 'Kebele 02', 40, 60, 25, 45, true),
('Harar', 'Kebele 03', 45, 70, 30, 50, true);

-- Insert cuisine types
INSERT INTO cuisine_categories (name, description, icon, display_order) VALUES
('Ethiopian', 'Traditional Ethiopian cuisine with injera and wot', '🇪🇹', 1),
('Italian', 'Pizza, pasta, and Italian specialties', '🇮🇹', 2),
('American', 'Burgers, fries, and American classics', '🇺🇸', 3),
('Chinese', 'Noodles, rice dishes, and Chinese favorites', '🇨🇳', 4),
('Indian', 'Curries, naan, and Indian specialties', '🇮🇳', 5),
('Fast Food', 'Quick bites and fast food options', '🍔', 6),
('Pizza', 'Various pizza styles and toppings', '🍕', 7),
('Breakfast', 'Morning meals and breakfast items', '🍳', 8),
('Desserts', 'Sweet treats and desserts', '🍰', 9),
('Beverages', 'Drinks, coffee, and refreshments', '🥤', 10),
('Local', 'Local Ethiopian specialties', '🥘', 11),
('Seafood', 'Fresh fish and seafood dishes', '🐟', 12),
('Vegetarian', 'Vegetarian and vegan options', '🥗', 13),
('Grill', 'Grilled meats and BBQ', '🔥', 14);

-- Insert default admin user (password: Admin@123 - change in production)
INSERT INTO users (phone_number, password_hash, full_name, email, role, is_phone_verified, is_active) 
VALUES ('+251911111111', '$2b$10$YourHashedPasswordHere', 'System Admin', 'admin@shewadelivery.com', 'admin', true, true)
ON CONFLICT (phone_number) DO NOTHING;