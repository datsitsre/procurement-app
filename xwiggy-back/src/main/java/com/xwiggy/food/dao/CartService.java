package com.xwiggy.food.dao;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.xwiggy.food.model.Food;
import com.xwiggy.food.model.NewFood;
import com.xwiggy.food.model.OrderLineRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Locale;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.UUID;

/**
 * The old cart/checkout flow (saveToCart/updateDB, backed by a single-row `cart` table keyed
 * by array position) has been replaced by the proper Order/OrderItem model - see
 * OrderService and OrderController. This class now only covers merchant inventory actions
 * (restocking existing items, adding new ones).
 */
@Service
public class CartService{

    private static final Set<String> ALLOWED_IMAGE_EXTENSIONS = Set.of("jpg", "jpeg", "png", "gif", "webp");

    @Autowired
    FoodDao foodDao;

    @Value("${fileStorage}")
    private String storagePath;

    public List<Food> addItems(List<OrderLineRequest> lines){
        for (OrderLineRequest line : lines) {
            if (line.getQuantity() <= 0) {
                throw new IllegalArgumentException("Quantity to add must be positive: " + line.getFoodId());
            }
            Food food = foodDao.findById(line.getFoodId())
                    .orElseThrow(() -> new NoSuchElementException("Unknown food item: " + line.getFoodId()));
            food.setQuantity(food.getQuantity() + line.getQuantity());
            foodDao.save(food);
        }
        return foodDao.findAll();
    }

    public boolean addNewItem(MultipartFile file, String newFoodData) throws IOException {
        NewFood newFood = new ObjectMapper().readValue(newFoodData,NewFood.class);
        validateNewFood(newFood);
        String storedName = null;
        if(!file.isEmpty()) {
            storedName = saveFileToAssets(file);
        }
        foodDao.save(new Food(newFood.getId(),newFood.getName(),newFood.getPrice(),newFood.getQuantityAvailable(),
                storedName != null ? "/assets/"+storedName : null,"","",newFood.getCategory()));
        return true;
    }

    public boolean addNewItemWithUrl(String newFoodData) throws IOException {
        NewFood newFood = new ObjectMapper().readValue(newFoodData,NewFood.class);
        validateNewFood(newFood);
        foodDao.save(new Food(newFood.getId(),newFood.getName(),newFood.getPrice(),newFood.getQuantityAvailable(),newFood.getFileDataF(),"","",newFood.getCategory()));
        return true;
    }

    private void validateNewFood(NewFood newFood) {
        if (foodDao.existsById(newFood.getId())) {
            throw new IllegalStateException("An item with this ID already exists: " + newFood.getId());
        }
        if (newFood.getPrice() < 0 || newFood.getQuantityAvailable() < 0) {
            throw new IllegalArgumentException("Price and quantity must not be negative");
        }
        if (newFood.getCategory() == null || newFood.getCategory().isBlank()) {
            throw new IllegalArgumentException("Category is required");
        }
    }

    /**
     * Never trusts the client-supplied filename as a path - it's reduced to just its extension
     * (checked against an allow-list) and combined with a generated name, so there is no way
     * for a request to write outside storagePath or overwrite an arbitrary existing file
     * (the original code passed file.getOriginalFilename() straight into Paths.get(...), which
     * was a path-traversal / arbitrary-file-write hole for any caller with MERCHANT role).
     */
    private String saveFileToAssets(MultipartFile file) throws IOException {
        String original = file.getOriginalFilename() == null ? "" : file.getOriginalFilename();
        int dot = original.lastIndexOf('.');
        String extension = dot >= 0 ? original.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
        if (!ALLOWED_IMAGE_EXTENSIONS.contains(extension)) {
            throw new IllegalArgumentException("Unsupported image file type: " + extension);
        }
        String safeName = UUID.randomUUID() + "." + extension;
        Path filepath = Paths.get(storagePath, safeName);
        file.transferTo(filepath);
        return safeName;
    }

    public boolean itemIdAvailable(String itemId) {
        return foodDao.findById(itemId).isPresent();
    }
}
