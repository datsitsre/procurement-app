-- Initial schema + seed data for a fresh `myusers` database, matching the JPA entities in
-- xwiggy-back (User, Food, Order, OrderItem). Auto-run by the official MySQL image on first
-- container start (mounted at /docker-entrypoint-initdb.d). Demo passwords are plaintext here
-- on purpose - PasswordMigrationRunner hashes them to BCrypt automatically the first time the
-- backend starts against this database.

CREATE TABLE `user` (
  `username` varchar(45) NOT NULL,
  `password` varchar(100) NOT NULL,
  `firstname` varchar(45) NOT NULL,
  `lastname` varchar(45) DEFAULT NULL,
  `email` varchar(45) DEFAULT NULL,
  `address` varchar(45) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `merchant` tinyint(4) NOT NULL,
  PRIMARY KEY (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `user` (`username`, `password`, `firstname`, `lastname`, `email`, `address`, `phone`, `merchant`) VALUES
('merchant', 'merchant', 'Merchant', 'Merchant', 'merchant@merchant.com', 'Merchant LTD', '1234567890', 1),
('user', 'user', 'Aman', 'Kumar', 'aman@gmail.com', 'Bangalore, India', '9585418', 0);

CREATE TABLE `food` (
  `id` varchar(45) NOT NULL,
  `item` varchar(45) NOT NULL,
  `price` int(11) NOT NULL,
  `quantity` int(11) DEFAULT NULL,
  `url` varchar(120) DEFAULT NULL,
  `formID` varchar(50) NOT NULL,
  `cartID` varchar(45) NOT NULL,
  `version` bigint NOT NULL DEFAULT 0,
  `category` varchar(30) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `food` (`id`, `item`, `price`, `quantity`, `url`, `formID`, `cartID`, `category`) VALUES
('abc', 'Coffee', 50, 20, 'https://images.pexels.com/photos/414720/pexels-photo-414720.jpeg', 'modalCart.quantity1', 'quantity1', 'Beverage'),
('bcd', 'Cookie', 20, 16, 'https://images-gmi-pmc.edge-generalmills.com/087d17eb-500e-4b26-abd1-4f9ffa96a2c6.jpg', 'modalCart.quantity2', 'quantity2', 'Bakery'),
('def', 'Cake', 80, 18, 'https://livforcake.com/wp-content/uploads/2017/07/black-forest-cake-thumb-500x500.jpg', 'modalCart.quantity3', 'quantity3', 'Bakery'),
('dos', 'Dosa', 100, 12, 'https://www.madhuseverydayindian.com/wp-content/uploads/2020/07/instant-wheat-flour-dosa-500x500.jpg', '', '', 'Tiffin'),
('idl', 'Idli', 30, 52, 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTUH0Y7rPn4A4J9Cv4roiAZn5eaNLbCr-7X7T_KXltM5g&s', '', '', 'Tiffin'),
('tea', 'Tea', 20, 40, 'https://images.pexels.com/photos/16942969/pexels-photo-16942969.jpeg', '', '', 'Beverage'),
('lsi', 'Lassi', 40, 25, 'https://images.pexels.com/photos/6808666/pexels-photo-6808666.jpeg', '', '', 'Beverage'),
('crs', 'Croissant', 60, 20, 'https://images.pexels.com/photos/1131379/pexels-photo-1131379.jpeg', '', '', 'Bakery'),
('brw', 'Brownie', 70, 15, 'https://images.pexels.com/photos/5386663/pexels-photo-5386663.jpeg', '', '', 'Bakery'),
('vad', 'Vada', 35, 30, 'https://images.pexels.com/photos/8312083/pexels-photo-8312083.jpeg', '', '', 'Tiffin'),
('upm', 'Upma', 45, 25, 'https://images.pexels.com/photos/20408455/pexels-photo-20408455.jpeg', '', '', 'Tiffin'),
('gjm', 'Gulab Jamun', 60, 30, 'https://images.pexels.com/photos/7406888/pexels-photo-7406888.jpeg', '', '', 'Sweets'),
('jlb', 'Jalebi', 55, 28, 'https://images.pexels.com/photos/36215924/pexels-photo-36215924.jpeg', '', '', 'Sweets'),
('sam', 'Samosa', 25, 40, 'https://images.pexels.com/photos/8992923/pexels-photo-8992923.jpeg', '', '', 'Snacks'),
('spr', 'Spring Roll', 65, 22, 'https://images.pexels.com/photos/35407775/pexels-photo-35407775.jpeg', '', '', 'Snacks');

CREATE TABLE `orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(45) NOT NULL,
  `order_date` datetime NOT NULL,
  `total` int NOT NULL,
  `status` varchar(20) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `order_item` (
  `id` int NOT NULL AUTO_INCREMENT,
  `order_id` int DEFAULT NULL,
  `food_id` varchar(45) DEFAULT NULL,
  `item_name` varchar(45) DEFAULT NULL,
  `quantity` int NOT NULL,
  `price` int NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_order_item_order` (`order_id`),
  CONSTRAINT `fk_order_item_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
